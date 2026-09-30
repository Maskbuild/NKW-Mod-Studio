import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { VANILLA_DATA_VERSION, groupOf, type VanillaData, type VanillaItem, type VanillaTag } from '@core/vanilla'
import { download, getJson } from './net'
import type { Progress } from './toolchain'

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

export function vanillaDir(toolsDir: string, mc: string): string {
  if (!VERSION_RE.test(mc)) throw new Error('Bad Minecraft version')
  return join(toolsDir, 'vanilla', mc)
}

export async function loadVanilla(toolsDir: string, mc: string): Promise<VanillaData | null> {
  try {
    const d = JSON.parse(await readFile(join(vanillaDir(toolsDir, mc), 'data.json'), 'utf8')) as VanillaData
    return d.v === VANILLA_DATA_VERSION ? d : null
  } catch {
    return null
  }
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
  const data = await extractItems(jar, 'minecraft', mc, join(dir, 'icons'), th, progress)
  await writeFile(join(dir, 'data.json'), JSON.stringify(data))
  await rm(jar, { force: true }) // icons/names are all we need; saves ~25 MB
  return data
}

/** Items, English (and optional Thai) names, icons and item tags of one namespace inside a jar. */
async function extractItems(jar: string, ns: string, mc: string, iconDir: string, th: Record<string, string>, progress: Progress): Promise<VanillaData> {
  const files = await readZip(
    jar,
    (n) =>
      n === `assets/${ns}/lang/en_us.json` ||
      new RegExp(`^assets/${ns}/(models/(item|block)|items)/[a-z0-9_]+\\.json$`).test(n) ||
      /^assets\/[a-z0-9_.-]+\/textures\/(item|block)\/[a-z0-9_/]+\.png$/.test(n) ||
      /^data\/[a-z0-9_.-]+\/tags\/items?\/[a-z0-9_/]+\.json$/.test(n)
  )
  const en = json<Record<string, string>>(files.get(`assets/${ns}/lang/en_us.json`)) ?? {}
  const split = (ref: string): [string, string] => {
    const i = ref.indexOf(':')
    return i < 0 ? ['minecraft', ref] : [ref.slice(0, i), ref.slice(i + 1)]
  }
  const model = (ref: string) => {
    const [n, p] = split(ref)
    return json<{ parent?: string; textures?: Record<string, string> }>(files.get(`assets/${n}/models/${p}.json`))
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
  return { v: VANILLA_DATA_VERSION, mc, ns, items, tags }
}

interface ModrinthVersion {
  version_type: string
  files: { url: string; primary: boolean; hashes: { sha1: string } }[]
}

/** Farmer's Delight items for a Minecraft version (from whichever loader build exists on Modrinth). */
export async function ensureFarmersDelight(toolsDir: string, mc: string, progress: Progress): Promise<VanillaData | null> {
  const dir = join(vanillaDir(toolsDir, mc), 'farmersdelight')
  try {
    const d = JSON.parse(await readFile(join(dir, 'data.json'), 'utf8')) as VanillaData
    if (d.v === VANILLA_DATA_VERSION) return d
  } catch {
    /* not cached */
  }
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
  const data = await extractItems(jar, 'farmersdelight', mc, join(dir, 'icons'), {}, progress)
  await writeFile(join(dir, 'data.json'), JSON.stringify(data))
  await rm(jar, { force: true })
  return data
}

export async function loadFarmersDelight(toolsDir: string, mc: string): Promise<VanillaData | null> {
  try {
    const d = JSON.parse(await readFile(join(vanillaDir(toolsDir, mc), 'farmersdelight', 'data.json'), 'utf8')) as VanillaData
    return d.v === VANILLA_DATA_VERSION ? d : null
  } catch {
    return null
  }
}

export function vanillaIconPath(toolsDir: string, mc: string, id: string, ns = 'minecraft'): string | null {
  if (!/^[a-z0-9_]{1,64}$/.test(id)) return null
  const base = vanillaDir(toolsDir, mc)
  const p = ns === 'farmersdelight' ? join(base, 'farmersdelight', 'icons', `${id}.png`) : join(base, 'icons', `${id}.png`)
  return existsSync(p) ? p : null
}
