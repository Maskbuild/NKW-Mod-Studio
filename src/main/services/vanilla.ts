import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import yauzl from 'yauzl'
import {
  LINKED_MOD_RE,
  VANILLA_DATA_VERSION,
  groupOf,
  isGrowingBlockstate,
  mainNamespace,
  type VanillaData,
  type VanillaItem,
  type VanillaTag
} from '@core/vanilla'
import { toId } from '@core/project'
import { download, getJson } from './net'
import type { Progress } from './toolchain'
import { decodePng, defaultTint, renderModel, resolveModel, type Img, type JsonModel } from './iso'

const VERSION_RE = /^\d+\.\d+(\.\d+)?$/

interface VersionJson {
  downloads: { client: { url: string; sha1: string; size: number } }
  assetIndex: { url: string; sha1: string }
}

/** Reads the zip entries accepted by `want` into memory. */
function readZip(file: string, want: (name: string) => boolean): Promise<Map<string, Buffer>> {
  return new Promise((ok, fail) => {
    const out = new Map<string, Buffer>()
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return fail(err ?? new Error('Cannot open jar'))
      zip.on('error', fail)
      zip.on('end', () => ok(out))
      zip.on('entry', (e: yauzl.Entry) => {
        if (!want(e.fileName) || e.uncompressedSize > 8 << 20) return zip.readEntry()
        zip.openReadStream(e, (er, s) => {
          if (er || !s) return fail(er ?? new Error('read error'))
          const chunks: Buffer[] = []
          s.on('data', (c: Buffer) => chunks.push(c))
          s.on('end', () => {
            out.set(e.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
          s.on('error', fail)
        })
      })
      zip.readEntry()
    })
  })
}

const json = <T>(b: Buffer | undefined): T | null => {
  if (!b) return null
  try {
    return JSON.parse(b.toString('utf8')) as T
  } catch {
    return null
  }
}

function vanillaDir(toolsDir: string, mc: string): string {
  if (!VERSION_RE.test(mc)) throw new Error('Bad Minecraft version')
  return join(toolsDir, 'vanilla', mc)
}

/** Extracted item data saved earlier, or null (missing, unreadable or from an older app version). */
async function readData(file: string): Promise<VanillaData | null> {
  try {
    const d = JSON.parse(await readFile(file, 'utf8')) as VanillaData
    return d.v === VANILLA_DATA_VERSION ? d : null
  } catch {
    return null
  }
}

export function loadVanilla(toolsDir: string, mc: string): Promise<VanillaData | null> {
  return readData(join(vanillaDir(toolsDir, mc), 'data.json'))
}

/**
 * Downloads the official client jar (SHA-1 from Mojang's manifest) and extracts every item with its
 * English/Thai name, an icon and the item tags. Result is cached per version.
 */
export async function ensureVanilla(toolsDir: string, mc: string, progress: Progress): Promise<VanillaData> {
  const cached = await loadVanilla(toolsDir, mc)
  if (cached) return cached
  const dir = vanillaDir(toolsDir, mc)
  await mkdir(dir, { recursive: true })

  progress(`Reading Minecraft ${mc} version info`)
  const manifest = await getJson<{ versions: { id: string; url: string }[] }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  const entry = manifest.versions.find((v) => v.id === mc)
  if (!entry) throw new Error(`Minecraft ${mc} not found`)
  const version = await getJson<VersionJson>(entry.url)

  const jar = join(dir, 'client.jar')
  progress(`Downloading Minecraft ${mc}`)
  await download(version.downloads.client.url, jar, version.downloads.client.sha1, (d, t) => progress(`Downloading Minecraft ${mc}`, d, t), 'sha1')

  progress('Reading items')
  // Thai names come from the asset index (not inside the jar)
  let th: Record<string, string> = {}
  try {
    const index = await getJson<{ objects: Record<string, { hash: string }> }>(version.assetIndex.url)
    const obj = index.objects['minecraft/lang/th_th.json']
    if (obj && /^[a-f0-9]{40}$/.test(obj.hash)) {
      const langFile = join(dir, 'th_th.json')
      await download(`https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`, langFile, obj.hash, undefined, 'sha1')
      th = JSON.parse(await readFile(langFile, 'utf8')) as Record<string, string>
    }
  } catch {
    /* Thai names are optional */
  }
  const { data, models } = await extractItems(jar, 'minecraft', mc, join(dir, 'icons'), th, progress)
  await writeFile(join(dir, 'models.json'), JSON.stringify(models))
  await extractSkins(jar, join(dir, 'skins'))
  await writeFile(join(dir, 'data.json'), JSON.stringify(data))
  await rm(jar, { force: true }) // icons/names are all we need; saves ~25 MB
  return data
}

/**
 * Items, English (and optional Thai) names, icons and item tags of one namespace inside a jar.
 * `parents` supplies vanilla block models for mods whose models inherit from them.
 */
async function extractItems(
  jar: string,
  ns: string,
  mc: string,
  iconDir: string,
  th: Record<string, string>,
  progress: Progress,
  parents: Record<string, JsonModel> = {}
): Promise<{ data: VanillaData; models: Record<string, JsonModel> }> {
  const files = await readZip(
    jar,
    (n) =>
      n === `assets/${ns}/lang/en_us.json` ||
      new RegExp(`^assets/${ns}/(models/(item|block)|items|blockstates)/[a-z0-9_/]+\\.json$`).test(n) ||
      /^assets\/[a-z0-9_.-]+\/textures\/(item|block)\/[a-z0-9_/]+\.png$/.test(n) ||
      /^data\/[a-z0-9_.-]+\/tags\/items?\/[a-z0-9_/]+\.json$/.test(n)
  )
  const en = json<Record<string, string>>(files.get(`assets/${ns}/lang/en_us.json`)) ?? {}
  const split = (ref: string): [string, string] => {
    const i = ref.indexOf(':')
    return i < 0 ? ['minecraft', ref] : [ref.slice(0, i), ref.slice(i + 1)]
  }
  const model = (ref: string): JsonModel | null => {
    const [n, p] = split(ref)
    return json<JsonModel>(files.get(`assets/${n}/models/${p}.json`)) ?? parents[`${n}:${p}`] ?? null
  }
  const decoded = new Map<string, Img | null>()
  const textureImg = (ref: string): Img | null => {
    const file = texFile(ref)
    if (!decoded.has(file)) {
      const buf = files.get(file)
      decoded.set(file, buf ? decodePng(buf) : null)
    }
    return decoded.get(file)!
  }
  const texFile = (ref: string) => {
    const [n, p] = split(ref)
    return `assets/${n}/textures/${p}.png`
  }

  /** Best icon texture for an item: layer0, else a representative face of its block model. */
  const iconFor = (id: string): Buffer | null => {
    const direct = files.get(`assets/${ns}/textures/item/${id}.png`)
    if (direct) return direct
    let ref = `${ns}:item/${id}`
    // 1.21.4+ item definitions can nest (select/condition/…): take the first plain model inside
    const def = json<unknown>(files.get(`assets/${ns}/items/${id}.json`))
    const firstModel = (o: unknown, depth = 0): string | null => {
      if (!o || typeof o !== 'object' || depth > 8) return null
      const r = o as Record<string, unknown>
      if (typeof r.model === 'string' && (r.type === 'minecraft:model' || r.type === 'model')) return r.model
      for (const v of Object.values(r)) {
        const hit = Array.isArray(v) ? v.map((x) => firstModel(x, depth + 1)).find(Boolean) : firstModel(v, depth + 1)
        if (hit) return hit
      }
      return null
    }
    const fromDef = firstModel(def)
    if (fromDef) ref = fromDef
    // block-like models are drawn in 3D, the way the inventory shows them
    const resolved = resolveModel(ref, model)
    if (resolved?.kind === 'elements') {
      const png = renderModel(resolved, textureImg, () => defaultTint(id))
      if (png) return png
    }
    for (let depth = 0; depth < 5; depth++) {
      const m = model(ref)
      if (!m) break
      const t = m.textures ?? {}
      for (const key of ['layer0', 'all', 'side', 'texture', 'front', 'top', 'end', 'particle', ...Object.keys(t)]) {
        const v = t[key]
        if (v && !v.startsWith('#')) {
          const buf = files.get(texFile(v))
          if (buf) return buf
        }
      }
      if (!m.parent) break
      ref = m.parent
    }
    return files.get(`assets/${ns}/textures/block/${id}.png`) ?? null
  }

  const ids = new Set<string>()
  const re = new RegExp(`^assets/${ns}/(?:items|models/item)/([a-z0-9_]+)\\.json$`)
  for (const name of files.keys()) {
    const m = re.exec(name)
    if (m && m[1] !== 'air' && (en[`item.${ns}.${m[1]}`] || en[`block.${ns}.${m[1]}`])) ids.add(m[1])
  }

  await rm(iconDir, { recursive: true, force: true })
  await mkdir(iconDir, { recursive: true })
  const items: VanillaItem[] = []
  let i = 0
  for (const id of [...ids].sort()) {
    if (++i % 200 === 0) progress('Extracting icons', i, ids.size)
    const itemKey = `item.${ns}.${id}`
    const blockKey = `block.${ns}.${id}`
    const icon = iconFor(id)
    if (icon) await writeFile(join(iconDir, `${id}.png`), icon)
    items.push({
      id,
      en: en[itemKey] ?? en[blockKey] ?? id,
      th: th[itemKey] ?? th[blockKey] ?? '',
      kind: en[itemKey] ? 'item' : 'block',
      icon: !!icon,
      group: groupOf(id)
    })
  }

  const tags: VanillaTag[] = []
  for (const [name, buf] of files) {
    const m = /^data\/([a-z0-9_.-]+)\/tags\/items?\/([a-z0-9_/]+)\.json$/.exec(name)
    if (!m || (ns === 'minecraft' && m[1] !== 'minecraft')) continue
    const t = json<{ values?: (string | { id: string })[] }>(buf)
    tags.push({ id: `${m[1]}:${m[2]}`, values: (t?.values ?? []).map((v) => (typeof v === 'string' ? v : v.id)) })
  }
  tags.sort((a, b) => a.id.localeCompare(b.id))
  // block models other mods can inherit from (cube_all, orientable, …)
  const models: Record<string, JsonModel> = {}
  for (const [name, buf] of files) {
    const m = /^assets\/([a-z0-9_.-]+)\/models\/(block\/[a-z0-9_/]+)\.json$/.exec(name)
    if (m) {
      const j = json<JsonModel>(buf)
      if (j) models[`${m[1]}:${m[2]}`] = j
    }
  }
  // growing blocks (crops): a blockstate keyed by "age"
  const crops: string[] = []
  for (const [name, buf] of files) {
    const m = /^assets\/([a-z0-9_.-]+)\/blockstates\/([a-z0-9_]+)\.json$/.exec(name)
    if (m && m[1] === ns && isGrowingBlockstate(json<unknown>(buf))) crops.push(m[2])
  }
  crops.sort()
  return { data: { v: VANILLA_DATA_VERSION, mc, ns, items, tags, crops }, models }
}

interface ModrinthVersion {
  version_type: string
  files: { url: string; primary: boolean; hashes: { sha1: string } }[]
}

/** Farmer's Delight items for a Minecraft version (from whichever loader build exists on Modrinth). */
export async function ensureFarmersDelight(toolsDir: string, mc: string, progress: Progress): Promise<VanillaData | null> {
  const dir = join(vanillaDir(toolsDir, mc), 'farmersdelight')
  const cached = await readData(join(dir, 'data.json'))
  if (cached) return cached
  progress(`Looking up Farmer's Delight for ${mc}`)
  let file: ModrinthVersion['files'][number] | undefined
  for (const [slug, loaders] of [
    ['farmers-delight', ['neoforge', 'forge']],
    ['farmers-delight-refabricated', ['fabric']]
  ] as const) {
    for (const loader of loaders) {
      const url = `https://api.modrinth.com/v2/project/${slug}/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
      const list = await getJson<ModrinthVersion[]>(url)
      const v = list.find((x) => x.version_type === 'release') ?? list[0]
      file = v?.files.find((x) => x.primary) ?? v?.files[0]
      if (file) break
    }
    if (file) break
  }
  if (!file) return null
  await mkdir(dir, { recursive: true })
  const jar = join(dir, 'fd.jar')
  await download(file.url, jar, file.hashes.sha1, (d, t) => progress("Downloading Farmer's Delight", d, t), 'sha1')
  let parents: Record<string, JsonModel> = {}
  try {
    parents = JSON.parse(await readFile(join(vanillaDir(toolsDir, mc), 'models.json'), 'utf8')) as Record<string, JsonModel>
  } catch {
    /* vanilla not extracted yet: Farmer's Delight blocks fall back to a flat face */
  }
  const { data } = await extractItems(jar, 'farmersdelight', mc, join(dir, 'icons'), {}, progress, parents)
  await writeFile(join(dir, 'data.json'), JSON.stringify(data))
  await rm(jar, { force: true })
  return data
}

// ───────── mods linked from Modrinth or picked as .jar files ─────────

const modDir = (toolsDir: string, mc: string, id: string): string => {
  if (!LINKED_MOD_RE.test(id)) throw new Error('Bad mod id')
  return join(vanillaDir(toolsDir, mc), 'mods', id)
}

/** A .jar picked on disk, kept for test runs. */
export const modJarPath = (toolsDir: string, mc: string, id: string) => join(modDir(toolsDir, mc, id), 'mod.jar')

export async function loadMod(toolsDir: string, mc: string, id: string): Promise<VanillaData | null> {
  return readData(join(modDir(toolsDir, mc, id), 'data.json'))
}

/** Vanilla block models (for mods whose models inherit from them), when the game's data was extracted. */
async function vanillaModels(toolsDir: string, mc: string): Promise<Record<string, JsonModel>> {
  try {
    return JSON.parse(await readFile(join(vanillaDir(toolsDir, mc), 'models.json'), 'utf8')) as Record<string, JsonModel>
  } catch {
    return {} // vanilla not extracted yet: the mod's blocks fall back to a flat face
  }
}

const MOD_META = /^(fabric\.mod\.json|quilt\.mod\.json|META-INF\/(neoforge\.)?mods\.toml)$/

/** The mod's id in game, from its fabric.mod.json / quilt.mod.json / mods.toml (the first mod listed). */
function jarModId(files: Map<string, Buffer>): string | undefined {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{1,63}$/.test(v)
  const fabric = json<{ id?: string }>(files.get('fabric.mod.json'))
  if (ok(fabric?.id)) return fabric.id
  const quilt = json<{ quilt_loader?: { id?: string } }>(files.get('quilt.mod.json'))
  if (ok(quilt?.quilt_loader?.id)) return quilt.quilt_loader.id
  for (const f of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const m = /^\s*modId\s*=\s*"([^"]+)"/m.exec(files.get(f)?.toString('utf8') ?? '')
    if (ok(m?.[1])) return m[1]
  }
  return undefined
}

/** Loaders a jar is made for, from its metadata files. */
function jarLoaders(files: Map<string, Buffer>): string[] {
  const out: string[] = []
  if (files.has('fabric.mod.json')) out.push('fabric', 'quilt')
  if (files.has('quilt.mod.json') && !out.includes('quilt')) out.push('quilt')
  if (files.has('META-INF/neoforge.mods.toml')) out.push('neoforge')
  const toml = files.get('META-INF/mods.toml')?.toString('utf8')
  if (toml) out.push(/modId\s*=\s*"neoforge"/.test(toml) ? 'neoforge' : 'forge')
  return out
}

/** Items, blocks, crops and tags of a mod jar, saved under the mod's id. */
async function extractMod(toolsDir: string, mc: string, id: string, jar: string, title: string, progress: Progress): Promise<VanillaData> {
  const names = await readZip(jar, (n) => MOD_META.test(n) || (/^assets\/[a-z0-9_.-]+\/(models\/(item|block)|items|lang)\//.test(n) && n.endsWith('.json')))
  const ns = mainNamespace([...names.keys()])
  if (!ns) throw new Error('No items or blocks found in this mod')
  const dir = modDir(toolsDir, mc, id)
  await mkdir(dir, { recursive: true })
  const { data } = await extractItems(jar, ns, mc, join(dir, 'icons'), {}, progress, await vanillaModels(toolsDir, mc))
  const modId = jarModId(names)
  const loaders = jarLoaders(names)
  const out: VanillaData = { ...data, title, ...(modId ? { modId } : {}), ...(loaders.length ? { loaders } : {}) }
  await writeFile(join(dir, 'data.json'), JSON.stringify(out))
  return out
}

export interface ModrinthHit {
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  categories: string[]
  /** loaders the mod has builds for (fabric, forge, neoforge, quilt) */
  loaders: string[]
  /** icon and a picture of the mod (Modrinth's CDN only) */
  icon: string | null
  image: string | null
}

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt']
/** Only pictures from Modrinth's CDN are shown (the app's image policy allows that host only). */
const cdn = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/cdn\.modrinth\.com\/[^\s"'<>]+$/.test(v) ? v : null)

/** Mods on Modrinth for a Minecraft version, 24 per page; sort: relevance, downloads, follows, newest, updated. */
export async function searchModrinth(query: string, mc: string, sort = 'relevance', offset = 0): Promise<{ hits: ModrinthHit[]; total: number }> {
  const facets = JSON.stringify([['project_type:mod'], [`versions:${mc}`]])
  const url = `https://api.modrinth.com/v2/search?limit=24&offset=${offset}&index=${encodeURIComponent(sort)}&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}`
  const res = await getJson<{ hits?: Record<string, unknown>[]; total_hits?: number }>(url)
  const hits = (res.hits ?? [])
    .filter((h) => typeof h.slug === 'string' && LINKED_MOD_RE.test(h.slug))
    .map((h) => {
      const gallery = Array.isArray(h.gallery) ? h.gallery : []
      const cats = Array.isArray(h.categories) ? h.categories.map(String) : []
      return {
        slug: String(h.slug),
        title: String(h.title ?? h.slug).slice(0, 100),
        description: String(h.description ?? '').slice(0, 400),
        author: String(h.author ?? '').slice(0, 60),
        downloads: Number(h.downloads) || 0,
        categories: cats.filter((c) => !LOADERS.includes(c)).slice(0, 4),
        loaders: cats.filter((c) => LOADERS.includes(c)),
        icon: cdn(h.icon_url),
        image: cdn(h.featured_gallery) ?? cdn(gallery[0])
      }
    })
  return { hits, total: Number(res.total_hits) || hits.length }
}

/** The newest file of a Modrinth project for a Minecraft version (release first, the first loader that has one). */
async function modrinthFile(slug: string, mc: string, loaders: readonly string[]): Promise<ModrinthVersion['files'][number] | undefined> {
  for (const loader of loaders) {
    const url = `https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
    const list = await getJson<ModrinthVersion[]>(url)
    const v = list.find((x) => x.version_type === 'release') ?? list[0]
    const file = v?.files.find((x) => x.primary) ?? v?.files[0]
    if (file) return file
  }
  return undefined
}

/** Downloads a Modrinth mod for a Minecraft version (checksum-checked) and reads its items; null when it has no build for it. */
export async function ensureModrinthMod(toolsDir: string, mc: string, slug: string, title: string, progress: Progress): Promise<VanillaData | null> {
  const cached = await loadMod(toolsDir, mc, slug)
  if (cached) return cached
  progress(`Looking up ${title} for ${mc}`)
  const file = await modrinthFile(slug, mc, ['fabric', 'neoforge', 'forge', 'quilt'])
  if (!file) return null
  const dir = modDir(toolsDir, mc, slug)
  await mkdir(dir, { recursive: true })
  const jar = join(dir, 'mod.jar')
  await download(file.url, jar, file.hashes.sha1, (d, t) => progress(`Downloading ${title}`, d, t), 'sha1')
  try {
    return await extractMod(toolsDir, mc, slug, jar, title, progress)
  } finally {
    await rm(jar, { force: true })
  }
}

/** Reads the items of a .jar picked on disk; its id is file_<name without the version>. */
export async function importModJar(toolsDir: string, mc: string, jar: string, progress: Progress): Promise<{ id: string; data: VanillaData }> {
  const info = await stat(jar)
  if (!info.isFile() || extname(jar).toLowerCase() !== '.jar') throw new Error('Not a .jar file')
  if (info.size > 512 * 1024 * 1024) throw new Error('The file is too large')
  const name = basename(jar, extname(jar))
  const id = `file_${toId(name.replace(/[-+_ ]?(mc|fabric|forge|neoforge|quilt)?[-+_ ]?\d+(\.\d+)+.*$/i, '')).slice(0, 50)}`
  progress(`Reading ${name}`)
  const data = await extractMod(toolsDir, mc, id, jar, name, progress)
  // kept for test runs (the project can add it to the game it starts)
  await copyFile(jar, modJarPath(toolsDir, mc, id))
  return { id, data }
}

export function loadFarmersDelight(toolsDir: string, mc: string): Promise<VanillaData | null> {
  return readData(join(vanillaDir(toolsDir, mc), 'farmersdelight', 'data.json'))
}

/**
 * The game's own Steve and Alex skins, used by the armor preview. They are read from the official
 * client jar the user downloads (never shipped with the app).
 */
async function extractSkins(jar: string, out: string): Promise<void> {
  const files = await readZip(jar, (n) => /^assets\/minecraft\/textures\/entity\/(player\/(wide|slim)\/)?(steve|alex)\.png$/.test(n))
  await mkdir(out, { recursive: true })
  for (const [name, variant] of [
    ['steve', 'wide'],
    ['alex', 'slim']
  ]) {
    const buf = files.get(`assets/minecraft/textures/entity/player/${variant}/${name}.png`) ?? files.get(`assets/minecraft/textures/entity/${name}.png`)
    if (buf) await writeFile(join(out, `${name}.png`), buf)
  }
}

export function vanillaSkinPath(toolsDir: string, mc: string, name: string): string | null {
  if (name !== 'steve' && name !== 'alex') return null
  const p = join(vanillaDir(toolsDir, mc), 'skins', `${name}.png`)
  return existsSync(p) ? p : null
}

/** Icon of an item: of the game, Farmer's Delight, or a linked mod (source "mod:<id>"). */
export function vanillaIconPath(toolsDir: string, mc: string, id: string, source = 'minecraft'): string | null {
  if (!/^[a-z0-9_]{1,64}$/.test(id)) return null
  const base = vanillaDir(toolsDir, mc)
  const mod = source.startsWith('mod:') ? source.slice(4) : null
  if (mod !== null && !LINKED_MOD_RE.test(mod)) return null
  const p =
    mod !== null
      ? join(base, 'mods', mod, 'icons', `${id}.png`)
      : source === 'farmersdelight'
        ? join(base, 'farmersdelight', 'icons', `${id}.png`)
        : join(base, 'icons', `${id}.png`)
  return existsSync(p) ? p : null
}
