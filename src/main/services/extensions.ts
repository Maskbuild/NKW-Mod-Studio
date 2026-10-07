import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { loadExtension, type FileMap, type LoadedExtension } from '@core/ext/manifest'
import { formatSource, isCommitSha, parseSource, type GitSource } from '@core/ext/source'
import { EXTENSION_ZIP_LIMITS, readZip } from './zipread'

/**
 * Installing extensions from git. A repository is resolved to one commit (latest release, else the default
 * branch, or the ref the user typed), that commit's archive is downloaded once, checked, and unpacked into
 * the local cache. From then on it is used offline. Nothing is ever executed: an extension is data.
 */

export interface GitNet {
  getJson<T>(url: string): Promise<T>
  getBuffer(url: string, maxBytes: number): Promise<Buffer>
}

export const MAX_ARCHIVE = 25_000_000

export interface Resolved {
  sha: string
  /** how the commit was chosen: the latest release, a branch (default or typed), a tag/branch typed by the user, or a commit id */
  via: 'release' | 'default-branch' | 'ref' | 'commit'
  /** the release tag, branch or ref that was resolved */
  label: string
}

export async function resolveRef(net: GitNet, src: GitSource): Promise<Resolved> {
  const api = `https://api.github.com/repos/${src.owner}/${src.repo}`
  const commit = async (ref: string) => {
    const c = await net.getJson<{ sha?: string }>(`${api}/commits/${encodeURIComponent(ref).replace(/%2F/g, '/')}`)
    if (!c.sha || !isCommitSha(c.sha)) throw new Error('GitHub did not return a commit id')
    return c.sha.toLowerCase()
  }
  if (src.ref) {
    if (isCommitSha(src.ref)) return { sha: src.ref.toLowerCase(), via: 'commit', label: src.ref.slice(0, 12) }
    return { sha: await commit(src.ref), via: 'ref', label: src.ref }
  }
  try {
    const rel = await net.getJson<{ tag_name?: string }>(`${api}/releases/latest`)
    if (rel.tag_name) return { sha: await commit(rel.tag_name), via: 'release', label: rel.tag_name }
  } catch (e) {
    if (!/HTTP 404/.test(String(e))) throw e
  }
  const repo = await net.getJson<{ default_branch?: string }>(api)
  if (!repo.default_branch) throw new Error('The repository has no default branch')
  return { sha: await commit(repo.default_branch), via: 'default-branch', label: repo.default_branch }
}

export interface Fetched {
  source: GitSource
  resolved: Resolved
  files: FileMap
  /** unpacked size in bytes */
  size: number
}

export async function fetchFromGit(net: GitNet, input: string): Promise<Fetched> {
  const source = parseSource(input)
  if (!source) throw new Error('That is not a GitHub repository. Write it like owner/repo or https://github.com/owner/repo')
  const resolved = await resolveRef(net, source)
  const zip = await net.getBuffer(`https://codeload.github.com/${source.owner}/${source.repo}/zip/${resolved.sha}`, MAX_ARCHIVE)
  const files = await readZip(zip, source.path, EXTENSION_ZIP_LIMITS)
  return { source, resolved, files, size: sizeOf(files) }
}

export const sizeOf = (files: FileMap) => [...files.values()].reduce((n, f) => n + (typeof f === 'string' ? Buffer.byteLength(f) : f.byteLength), 0)

// ───────── what the user is shown before installing ─────────

export interface ExtensionPreview {
  id: string
  name: { en: string; th: string }
  description: { en: string; th: string }
  version: string
  author?: string
  minApp?: string
  requires: Record<string, string>
  nodes: number
  generates: number
  size: number
  files: number
  /** Minecraft versions / loaders it supports (empty: all) */
  targets: { mc?: string; loaders?: string[] }
}

export function previewOf(ext: LoadedExtension, size: number, files: number): ExtensionPreview {
  const m = ext.manifest
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    version: m.version,
    author: m.author,
    minApp: m.minApp,
    requires: m.requires,
    nodes: ext.nodes.length,
    generates: m.generate.length + m.hooks.length,
    size,
    files,
    targets: m.targets
  }
}

// ───────── the local cache ─────────

export interface InstalledRecord {
  id: string
  version: string
  /** where it came from: a GitHub address, or "local:<folder>" while developing */
  source: string
  sha: string
  via: Resolved['via'] | 'local'
  enabled: boolean
  installedAt: string
  /** folder name under the cache root */
  dir: string
  /** older folders kept for roll-back */
  previous: { version: string; sha: string; dir: string }[]
}

const STATE = 'state.json'
const KEEP_PREVIOUS = 1
const DIR_RE = /^[a-z][a-z0-9-]{2,40}@[a-z0-9]{1,12}$/

export class ExtensionStore {
  constructor(private root: string) {}

  private async read(): Promise<InstalledRecord[]> {
    try {
      const list = JSON.parse(await readFile(join(this.root, STATE), 'utf8')) as InstalledRecord[]
      return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string' && DIR_RE.test(r.dir)) : []
    } catch {
      return []
    }
  }

  private async write(list: InstalledRecord[]): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const tmp = join(this.root, `${STATE}.part`)
    await writeFile(tmp, JSON.stringify(list, null, 2))
    await rename(tmp, join(this.root, STATE))
  }

  list(): Promise<InstalledRecord[]> {
    return this.read()
  }

  private dirPath(dir: string): string {
    if (!DIR_RE.test(dir)) throw new Error('Bad extension folder')
    return join(this.root, dir)
  }

  /** Writes the files into the cache and records them (replacing an older install of the same extension). */
  async install(ext: LoadedExtension, files: FileMap, info: { source: string; sha: string; via: InstalledRecord['via'] }): Promise<InstalledRecord> {
    const id = ext.manifest.id
    const dir = `${id}@${
      info.sha
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 12)
        .toLowerCase() || 'local'
    }`
    const target = this.dirPath(dir)
    const root = resolve(target)
    await rm(target, { recursive: true, force: true })
    for (const [rel, data] of files) {
      const dest = resolve(root, rel)
      if (dest !== root && !dest.startsWith(root + sep)) throw new Error(`Unsafe path: ${rel}`)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, data)
    }
    const list = await this.read()
    const old = list.find((r) => r.id === id)
    const previous = old ? [{ version: old.version, sha: old.sha, dir: old.dir }, ...old.previous].filter((p) => p.dir !== dir) : []
    for (const gone of previous.slice(KEEP_PREVIOUS)) await rm(this.dirPath(gone.dir), { recursive: true, force: true })
    const rec: InstalledRecord = {
      id,
      version: ext.manifest.version,
      source: info.source,
      sha: info.sha,
      via: info.via,
      enabled: old?.enabled ?? true,
      installedAt: new Date().toISOString(),
      dir,
      previous: previous.slice(0, KEEP_PREVIOUS)
    }
    await this.write([...list.filter((r) => r.id !== id), rec].sort((a, b) => a.id.localeCompare(b.id)))
    return rec
  }

  async remove(id: string): Promise<void> {
    const list = await this.read()
    const rec = list.find((r) => r.id === id)
    if (!rec) return
    for (const d of [rec.dir, ...rec.previous.map((p) => p.dir)]) await rm(this.dirPath(d), { recursive: true, force: true })
    await this.write(list.filter((r) => r.id !== id))
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const list = await this.read()
    const rec = list.find((r) => r.id === id)
    if (!rec) throw new Error('Not installed')
    rec.enabled = enabled
    await this.write(list)
  }

  /** Goes back to the previous version that was kept. */
  async rollback(id: string): Promise<InstalledRecord> {
    const list = await this.read()
    const rec = list.find((r) => r.id === id)
    const prev = rec?.previous[0]
    if (!rec || !prev) throw new Error('There is no earlier version')
    const swapped: InstalledRecord = {
      ...rec,
      version: prev.version,
      sha: prev.sha,
      dir: prev.dir,
      previous: [{ version: rec.version, sha: rec.sha, dir: rec.dir }]
    }
    await this.write(list.map((r) => (r.id === id ? swapped : r)))
    return swapped
  }

  /** Every file of an installed extension (text as strings, assets as bytes). */
  async files(rec: Pick<InstalledRecord, 'dir'>): Promise<FileMap> {
    const base = this.dirPath(rec.dir)
    const out: FileMap = new Map()
    const walk = async (rel: string): Promise<void> => {
      for (const e of await readdir(join(base, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(r)
        else if (e.isFile()) {
          const buf = await readFile(join(base, r))
          out.set(r, /\.(json|tpl|md|txt|lua|properties|mcmeta|cfg|toml|ya?ml)$/i.test(r) ? buf.toString('utf8') : new Uint8Array(buf))
        }
      }
    }
    await walk('')
    return out
  }

  /** The enabled extensions, loaded and validated again (a damaged one is reported and skipped). */
  async loadEnabled(): Promise<{ loaded: LoadedExtension[]; problems: { id: string; errors: string[] }[] }> {
    const loaded: LoadedExtension[] = []
    const problems: { id: string; errors: string[] }[] = []
    for (const rec of await this.read()) {
      if (!rec.enabled) continue
      try {
        const r = loadExtension(await this.files(rec))
        if (r.ok) loaded.push(r.ext)
        else problems.push({ id: rec.id, errors: r.errors })
      } catch (e) {
        problems.push({ id: rec.id, errors: [String(e)] })
      }
    }
    return { loaded, problems }
  }
}

/** Reads a folder from disk (installing an extension while developing it). */
export async function readFolder(dir: string): Promise<FileMap> {
  const root = resolve(dir)
  const out: FileMap = new Map()
  let count = 0
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else if (e.isFile()) {
        if (++count > EXTENSION_ZIP_LIMITS.files) throw new Error('Too many files')
        const full = join(root, r)
        if ((await stat(full)).size > EXTENSION_ZIP_LIMITS.file) throw new Error(`${r} is too large`)
        const buf = await readFile(full)
        out.set(r, /\.(json|tpl|md|txt|lua|properties|mcmeta|cfg|toml|ya?ml)$/i.test(r) ? buf.toString('utf8') : new Uint8Array(buf))
      }
    }
  }
  await walk('')
  return out
}

export { formatSource }
