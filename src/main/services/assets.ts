import { existsSync } from 'node:fs'
import { bbmodelToGeo, geoBones, isEntityBBModel } from '@core/gen/geo'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, posix } from 'node:path'
import { convertBBModel, parseJavaModel, textureKeys } from '@core/gen/model'
import { ASSET_RE, toId } from '@core/project'
import { CONVERTIBLE, convertToOgg, oggSeconds, type ConvertOptions } from './audio'

export type AssetKind = 'texture' | 'model' | 'geo' | 'sound' | 'animation'

export interface ImportedAsset {
  asset: string
  kind: AssetKind
  name: string
  textureSlots?: number
  /** animation names inside a GeckoLib .animation.json */
  animations?: string[]
  /** sound length in seconds */
  seconds?: number
  /** textures extracted from a .bbmodel, in slot order */
  textures?: string[]
  width?: number
  height?: number
  warning?: string
}

export interface AssetEntry {
  asset: string
  kind: AssetKind | 'folder'
  seconds?: number
}

/** Top-level folder for every asset kind. Sub-folders below these are free-form. */
export const ROOT: Record<AssetKind, string> = { texture: 'textures', model: 'models', geo: 'geo', sound: 'sounds', animation: 'animations' }
const ROOTS = Object.values(ROOT)
const EXT: Record<AssetKind, string> = { texture: 'png', model: 'json', geo: 'json', sound: 'ogg', animation: 'json' }
/** folder path below the assets directory, e.g. "textures/weapons/swords" */
export const FOLDER_RE = /^(textures|models|geo|sounds|animations)(\/[a-z0-9_]{1,64}){0,4}$/

/** bytes; plain multiplication on purpose — `2048 << 20` overflows 32-bit and goes negative */
const MB = 1024 * 1024
const LIMITS: Record<AssetKind, number> = { texture: 4 * MB, model: 10 * MB, geo: 10 * MB, sound: 64 * MB, animation: 10 * MB }
/** audio/video that gets converted to .ogg (only the sound is kept) */
export const CONVERT_LIMIT = 2048 * MB
export const EXTENSIONS: Record<AssetKind, string[]> = {
  texture: ['png'],
  animation: ['json'],
  model: ['json', 'bbmodel'],
  geo: ['json', 'bbmodel'],
  sound: CONVERTIBLE
}

function uniqueName(dir: string, base: string, ext: string): string {
  let name = base || 'file'
  for (let i = 2; existsSync(join(dir, `${name}.${ext}`)); i++) name = `${base}_${i}`
  return name
}

/** Folder for an import: the requested sub-folder when it lives under the kind's root, else the root. */
function targetFolder(kind: AssetKind, folder?: string): string {
  if (folder && FOLDER_RE.test(folder) && folder.split('/')[0] === ROOT[kind]) return folder
  return ROOT[kind]
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function writePng(projectDir: string, folder: string, base: string, buf: Buffer): Promise<ImportedAsset> {
  const size = pngSize(buf)
  if (!size) throw new Error('Not a valid PNG image')
  if (size.width > 4096 || size.height > 4096) throw new Error('Image is larger than 4096×4096')
  const dir = join(projectDir, 'assets', folder)
  await mkdir(dir, { recursive: true })
  const name = uniqueName(dir, base, 'png')
  await writeFile(join(dir, `${name}.png`), buf)
  const pow2 = (n: number) => (n & (n - 1)) === 0
  return {
    asset: `${folder}/${name}.png`,
    kind: 'texture',
    name,
    ...size,
    warning: !pow2(size.width) || !pow2(size.height) ? 'Size is not a power of two (16, 32, 64…)' : undefined
  }
}

/** Copies a user-picked file into the project, validating its type by content. Audio/video is converted to .ogg. */
export async function importAsset(
  projectDir: string,
  source: string,
  kind: AssetKind,
  audio: ConvertOptions = { mono: true, volume: 1 },
  folder?: string
): Promise<ImportedAsset[]> {
  const ext = extname(source).slice(1).toLowerCase()
  if (!EXTENSIONS[kind].includes(ext)) throw new Error(`Unsupported file type .${ext}`)
  const info = await stat(source)
  if (!info.isFile()) throw new Error('Not a file')
  const into = targetFolder(kind, folder)
  const dir = join(projectDir, 'assets', into)
  await mkdir(dir, { recursive: true })
  // names with no latin letters (e.g. Thai file names) fall back to the asset type
  const raw = toId(basename(source, extname(source)).replace(/\.(geo|animation)$/, ''))
  const base = raw === 'unnamed' ? kind : raw

  const convert = kind === 'sound' && (ext !== 'ogg' || Math.abs(audio.volume - 1) > 0.001)
  // audio/video sources get converted, so larger originals (e.g. an .mp4 video) are fine
  if (info.size > (convert ? CONVERT_LIMIT : LIMITS[kind])) throw new Error('File is too large')
  if (convert) {
    const name = uniqueName(dir, base, 'ogg')
    const out = join(dir, `${name}.ogg`)
    await convertToOgg(source, out, audio)
    return [{ asset: `${into}/${name}.ogg`, kind, name, seconds: (await oggSeconds(out)) ?? undefined }]
  }
  const buf = await readFile(source)

  switch (kind) {
    case 'texture':
      return [await writePng(projectDir, into, base, buf)]
    case 'sound': {
      if (buf.subarray(0, 4).toString('latin1') !== 'OggS') throw new Error('Not an Ogg Vorbis (.ogg) file')
      const name = uniqueName(dir, base, 'ogg')
      await writeFile(join(dir, `${name}.ogg`), buf)
      const seconds = await oggSeconds(join(dir, `${name}.ogg`)).catch(() => null)
      return [{ asset: `${into}/${name}.ogg`, kind, name, seconds: seconds ?? undefined }]
    }
    case 'animation': {
      const json = JSON.parse(buf.toString('utf8')) as { animations?: Record<string, unknown> }
      if (!json || typeof json.animations !== 'object' || json.animations === null) throw new Error('Not a GeckoLib/Bedrock .animation.json file')
      const name = uniqueName(dir, base.replace(/_animation$/, ''), 'json')
      await writeFile(join(dir, `${name}.json`), JSON.stringify(json))
      return [{ asset: `${into}/${name}.json`, kind, name, animations: Object.keys(json.animations).slice(0, 200) }]
    }
    case 'geo': {
      if (ext === 'bbmodel') {
        // Blockbench project → GeckoLib model, same as Blockbench's export; embedded textures become PNGs
        const conv = bbmodelToGeo(buf.toString('utf8'), `geometry.${base}`)
        if (!geoBones(conv.geo).some((b) => b.cubes?.length)) throw new Error('The Blockbench model has no cubes')
        const name = uniqueName(dir, base, 'json')
        const extra: ImportedAsset[] = []
        const textures: string[] = []
        for (const [i, t] of conv.textures.entries()) {
          if (!t.base64) continue
          const png = await writePng(projectDir, ROOT.texture, toId(t.name.replace(/.png$/i, '')) || `${base}_${i}`, Buffer.from(t.base64, 'base64'))
          textures.push(png.asset)
          extra.push(png)
        }
        await writeFile(join(dir, `${name}.json`), JSON.stringify(conv.geo))
        return [{ asset: `${into}/${name}.json`, kind, name, textures }, ...extra]
      }
      const json = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
      if (!Array.isArray(json['minecraft:geometry'])) throw new Error('Not a GeckoLib/Bedrock .geo.json model')
      const name = uniqueName(dir, base, 'json')
      await writeFile(join(dir, `${name}.json`), JSON.stringify(json))
      return [{ asset: `${into}/${name}.json`, kind, name }]
    }
    case 'model': {
      if (ext === 'bbmodel') {
        const conv = convertBBModel(buf.toString('utf8'))
        const name = uniqueName(dir, base, 'json')
        const textures: string[] = []
        const extra: ImportedAsset[] = []
        for (const [i, t] of conv.textures.entries()) {
          if (!t.base64) continue
          const png = await writePng(projectDir, ROOT.texture, toId(t.name.replace(/\.png$/i, '')) || `${base}_${i}`, Buffer.from(t.base64, 'base64'))
          textures[i] = png.asset
          extra.push(png)
        }
        await writeFile(join(dir, `${name}.json`), JSON.stringify(conv.model))
        return [{ asset: `${into}/${name}.json`, kind, name, textureSlots: Math.min(4, conv.textures.length || 1), textures }, ...extra]
      }
      const model = parseJavaModel(buf.toString('utf8'))
      const name = uniqueName(dir, base, 'json')
      await writeFile(join(dir, `${name}.json`), JSON.stringify(model))
      const slots = textureKeys(model).length
      return [
        {
          asset: `${into}/${name}.json`,
          kind,
          name,
          textureSlots: Math.min(4, Math.max(1, slots)),
          warning: slots > 4 ? 'Model uses more than 4 textures; only 4 can be connected' : undefined
        }
      ]
    }
  }
}

/** Guesses the asset kind of a dropped file from its extension and content. */
export async function detectKind(source: string): Promise<AssetKind | null> {
  const ext = extname(source).slice(1).toLowerCase()
  if (ext === 'png') return 'texture'
  if (CONVERTIBLE.includes(ext)) return 'sound'
  if (ext === 'bbmodel') {
    // entity/armor projects (bones) become GeckoLib models, block/item projects Java models
    const info = await stat(source)
    if (!info.isFile() || info.size > 10 * MB) return null
    return isEntityBBModel(await readFile(source, 'utf8')) ? 'geo' : 'model'
  }
  if (ext !== 'json') return null
  const info = await stat(source)
  if (!info.isFile() || info.size > 10 * MB) return null
  try {
    const j = JSON.parse(await readFile(source, 'utf8')) as Record<string, unknown>
    if (Array.isArray(j['minecraft:geometry'])) return 'geo'
    if (j.animations && typeof j.animations === 'object') return 'animation'
    if (Array.isArray(j.elements) || typeof j.parent === 'string') return 'model'
  } catch {
    return null
  }
  return null
}

function checkAsset(asset: string, root?: string): void {
  if (!ASSET_RE.test(asset) || (root && asset.split('/')[0] !== root)) throw new Error('Invalid asset path')
}

export async function animationNames(projectDir: string, asset: string): Promise<string[]> {
  checkAsset(asset, 'animations')
  const j = JSON.parse(await readFile(join(projectDir, 'assets', asset), 'utf8')) as { animations?: Record<string, unknown> }
  return Object.keys(j.animations ?? {}).slice(0, 200)
}

/** Every asset and folder (recursive). GeckoLib models from older projects (models/x_geo.json) are reported as geo. */
export async function listAssets(projectDir: string): Promise<AssetEntry[]> {
  const out: AssetEntry[] = []
  const walk = async (rel: string, kind: AssetKind, depth: number) => {
    let entries
    try {
      entries = await readdir(join(projectDir, 'assets', rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const path = `${rel}/${e.name}`
      if (e.isDirectory()) {
        if (depth < 4 && /^[a-z0-9_]{1,64}$/.test(e.name)) {
          out.push({ asset: path, kind: 'folder' })
          await walk(path, kind, depth + 1)
        }
      } else if (ASSET_RE.test(path)) {
        const k: AssetKind = kind === 'model' && e.name.endsWith('_geo.json') ? 'geo' : kind
        const entry: AssetEntry = { asset: path, kind: k }
        if (k === 'sound') entry.seconds = (await oggSeconds(join(projectDir, 'assets', path)).catch(() => null)) ?? undefined
        out.push(entry)
      }
    }
  }
  for (const [kind, root] of Object.entries(ROOT) as [AssetKind, string][]) await walk(root, kind, 0)
  return out
}

/** Reads a model file for the 3D preview. */
export async function readModel(projectDir: string, asset: string): Promise<unknown> {
  checkAsset(asset)
  if (!['models', 'geo'].includes(asset.split('/')[0]) || !asset.endsWith('.json')) throw new Error('Invalid asset path')
  return JSON.parse(await readFile(join(projectDir, 'assets', asset), 'utf8'))
}

// ───────── model editor ─────────

/** Writes a file atomically (temp file + rename), creating its folder. */
async function writeAssetFile(projectDir: string, asset: string, data: string | Buffer): Promise<void> {
  const file = join(projectDir, 'assets', asset)
  await mkdir(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** Saves a Java block/item model made in the model editor (models/*.json). */
export async function writeModel(projectDir: string, asset: string, model: unknown): Promise<void> {
  checkAsset(asset, 'models')
  if (!asset.endsWith('.json') || typeof model !== 'object' || model === null || Array.isArray(model)) throw new Error('Invalid model')
  const text = JSON.stringify(model, null, 2)
  if (text.length > 4_000_000) throw new Error('Model is too large')
  await writeAssetFile(projectDir, asset, text + '\n')
}

/** Saves a texture painted in the model editor (textures/*.png, base64 PNG). */
export async function writeTexture(projectDir: string, asset: string, pngBase64: string): Promise<void> {
  checkAsset(asset, 'textures')
  if (!asset.endsWith('.png')) throw new Error('Invalid texture path')
  const png = Buffer.from(pngBase64, 'base64')
  if (png.length > 8_000_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG image')
  await writeAssetFile(projectDir, asset, png)
}

// ───────── file management (tree view) ─────────

export async function makeFolder(projectDir: string, folder: string): Promise<void> {
  if (!FOLDER_RE.test(folder) || ROOTS.includes(folder)) throw new Error('Invalid folder name')
  await mkdir(join(projectDir, 'assets', folder), { recursive: true })
}

/**
 * Renames or moves a file or folder (inside the same top-level folder).
 * Returns every asset path that changed so the graph can be updated.
 */
export async function moveAsset(projectDir: string, from: string, to: string): Promise<{ from: string; to: string }[]> {
  const isFolder = FOLDER_RE.test(from) && !extname(from)
  if (isFolder) {
    if (ROOTS.includes(from)) throw new Error('Top-level folders cannot be renamed')
    if (!FOLDER_RE.test(to) || ROOTS.includes(to)) throw new Error('Invalid folder name')
    if (to === from || to.startsWith(`${from}/`)) throw new Error('Cannot move a folder into itself')
  } else {
    checkAsset(from)
    checkAsset(to)
    if (extname(from) !== extname(to)) throw new Error('The file extension cannot change')
  }
  if (from.split('/')[0] !== to.split('/')[0]) throw new Error('Files stay in their own top-level folder')
  const src = join(projectDir, 'assets', from)
  const dest = join(projectDir, 'assets', to)
  if (!existsSync(src)) throw new Error('File not found')
  if (existsSync(dest)) throw new Error('A file or folder with that name already exists')
  // collect affected asset paths before moving
  const changed: { from: string; to: string }[] = []
  if (isFolder) {
    for (const e of await listAssets(projectDir))
      if (e.kind !== 'folder' && e.asset.startsWith(`${from}/`)) changed.push({ from: e.asset, to: to + e.asset.slice(from.length) })
  } else changed.push({ from, to })
  await mkdir(join(projectDir, 'assets', posix.dirname(to)), { recursive: true })
  await rename(src, dest)
  return changed
}

/** Paths of every asset inside `path` (or the file itself) — used to clear graph references after deleting. */
export async function assetsUnder(projectDir: string, path: string): Promise<string[]> {
  if (ASSET_RE.test(path)) return [path]
  if (!FOLDER_RE.test(path) || ROOTS.includes(path)) throw new Error('Invalid path')
  return (await listAssets(projectDir)).filter((e) => e.kind !== 'folder' && e.asset.startsWith(`${path}/`)).map((e) => e.asset)
}

export { EXT as ASSET_EXT }
