import { randomUUID } from 'node:crypto'
import { extHost } from '@core/ext/host'
import { loadExtension, type FileMap, type LoadedExtension } from '@core/ext/manifest'
import { formatSource } from '@core/ext/source'
import { satisfies } from '@core/ext/semver'
import {
  ExtensionStore,
  fetchFromGit,
  previewOf,
  readFolder,
  resolveRef,
  sizeOf,
  type ExtensionPreview,
  type Fetched,
  type GitNet,
  type InstalledRecord
} from './extensions'
import { parseSource } from '@core/ext/source'

/**
 * The extensions this process has turned on, kept in step with the local cache. An install is two steps:
 * `inspect` downloads and validates into memory and returns what the user should look at; `install`
 * (with the token from `inspect`) writes it to the cache and turns it on.
 */

export interface Inspected {
  token: string
  preview: ExtensionPreview
  source: string
  sha: string
  via: string
  label: string
  /** the extension is installed already, at this version */
  installed: { version: string; sha: string } | null
  /** problems that stop the install (empty: fine) */
  errors: string[]
  /** other extensions it needs that are missing or too old */
  missing: string[]
}

export class ExtensionRuntime {
  private pending = new Map<string, { ext: LoadedExtension; files: FileMap; source: string; sha: string; via: InstalledRecord['via'] }>()
  /** extensions this runtime enabled from the cache (as opposed to ones the app turned on itself) */
  private fromCache = new Set<string>()

  constructor(
    readonly store: ExtensionStore,
    private net: GitNet,
    private appVersion: string
  ) {}

  /** Turns the enabled extensions of the cache on and the others off. Returns what could not be loaded. */
  async sync(): Promise<{ id: string; errors: string[] }[]> {
    for (const id of this.fromCache) extHost.disable(id)
    this.fromCache.clear()
    const { loaded, problems } = await this.store.loadEnabled()
    for (const ext of loaded) {
      const id = ext.manifest.id
      if (extHost.has(id)) continue
      if (ext.manifest.minApp && !satisfies(this.appVersion, `>=${ext.manifest.minApp}`)) {
        problems.push({ id, errors: [`Needs NKW Mod Studio ${ext.manifest.minApp} or newer`] })
        continue
      }
      try {
        extHost.enable(ext)
        this.fromCache.add(id)
      } catch (e) {
        problems.push({ id, errors: [(e as Error).message] })
      }
    }
    return problems
  }

  private async check(ext: LoadedExtension): Promise<{ errors: string[]; missing: string[] }> {
    const errors: string[] = []
    const missing: string[] = []
    const m = ext.manifest
    if (m.minApp && !satisfies(this.appVersion, `>=${m.minApp}`)) errors.push(`Needs NKW Mod Studio ${m.minApp} or newer (this is ${this.appVersion})`)
    const have = new Map((await this.store.list()).map((r) => [r.id, r.version]))
    for (const [id, range] of Object.entries(m.requires)) {
      const v = have.get(id)
      if (!v || !satisfies(v, range)) missing.push(`${id} ${range}`)
    }
    return { errors, missing }
  }

  private async stage(
    ext: LoadedExtension,
    files: FileMap,
    size: number,
    source: string,
    sha: string,
    via: InstalledRecord['via'],
    label: string
  ): Promise<Inspected> {
    const token = randomUUID()
    this.pending.set(token, { ext, files, source, sha, via })
    // keep a few pending installs at most
    for (const old of [...this.pending.keys()].slice(0, -4)) this.pending.delete(old)
    const rec = (await this.store.list()).find((r) => r.id === ext.manifest.id)
    const { errors, missing } = await this.check(ext)
    return {
      token,
      preview: previewOf(ext, size, files.size),
      source,
      sha,
      via,
      label,
      installed: rec ? { version: rec.version, sha: rec.sha } : null,
      errors,
      missing
    }
  }

  async inspectGit(input: string): Promise<Inspected> {
    const got: Fetched = await fetchFromGit(this.net, input)
    const r = loadExtension(got.files)
    if (!r.ok) throw new Error(`This is not a valid extension:\n${r.errors.slice(0, 8).join('\n')}`)
    return this.stage(r.ext, got.files, got.size, formatSource(got.source), got.resolved.sha, got.resolved.via, got.resolved.label)
  }

  async inspectFolder(dir: string): Promise<Inspected> {
    const files = await readFolder(dir)
    const r = loadExtension(files)
    if (!r.ok) throw new Error(`This is not a valid extension:\n${r.errors.slice(0, 8).join('\n')}`)
    return this.stage(r.ext, files, sizeOf(files), `local:${dir}`, 'local', 'local', 'local folder')
  }

  async install(token: string): Promise<InstalledRecord> {
    const p = this.pending.get(token)
    if (!p) throw new Error('That install has expired. Look at the extension again.')
    this.pending.delete(token)
    const { errors } = await this.check(p.ext)
    if (errors.length) throw new Error(errors.join('\n'))
    const rec = await this.store.install(p.ext, p.files, { source: p.source, sha: p.sha, via: p.via })
    await this.sync()
    return rec
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id)
    await this.sync()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.store.setEnabled(id, enabled)
    await this.sync()
  }

  async rollback(id: string): Promise<InstalledRecord> {
    const rec = await this.store.rollback(id)
    await this.sync()
    return rec
  }

  /** Which installed extensions have a newer release or commit upstream. */
  async checkUpdates(): Promise<{ id: string; current: string; latest: string; label: string }[]> {
    const out: { id: string; current: string; latest: string; label: string }[] = []
    for (const rec of await this.store.list()) {
      const src = parseSource(rec.source)
      if (!src || rec.via === 'local' || rec.via === 'commit') continue
      try {
        const r = await resolveRef(this.net, src)
        if (r.sha !== rec.sha) out.push({ id: rec.id, current: rec.sha.slice(0, 7), latest: r.sha.slice(0, 7), label: r.label })
      } catch {
        // offline or rate limited: say nothing
      }
    }
    return out
  }

  /** The text files of every extension that is on, for the renderer (editing and checking projects). */
  bundle(): { id: string; files: Record<string, string> }[] {
    return extHost.list().map((e) => ({
      id: e.manifest.id,
      files: Object.fromEntries([...e.files].filter((f): f is [string, string] => typeof f[1] === 'string'))
    }))
  }
}
