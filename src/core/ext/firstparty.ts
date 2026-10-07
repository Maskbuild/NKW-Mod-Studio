/// <reference types="vite/client" />
import { extHost } from './host'
import { loadExtension, type FileMap } from './manifest'

/**
 * The extensions that live in this repository's `extensions/` folder. Until extensions are installed from
 * git (and read from the local cache), the app turns these on at start-up, so every context that compiles a
 * project (editor, validation worker, builder) sees the same nodes.
 */
const raw = import.meta.glob('../../../extensions/**/*.{json,tpl}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

/** folder name → files, paths relative to the extension's folder */
function byFolder(): Map<string, FileMap> {
  const out = new Map<string, FileMap>()
  for (const [path, text] of Object.entries(raw)) {
    const m = /\/extensions\/([^/]+)\/(.+)$/.exec(path)
    if (!m || m[1].startsWith('_')) continue
    // tests are fixtures for the extension's own test run, not part of what it ships
    if (m[2].startsWith('tests/')) continue
    if (!out.has(m[1])) out.set(m[1], new Map())
    out.get(m[1])!.set(m[2], text)
  }
  return out
}

/** Turns on the extensions of the `extensions/` folder (once; extensions already on are left alone). */
export function enableFirstParty(only?: string[]): void {
  for (const [folder, files] of byFolder()) {
    if (only && !only.includes(folder)) continue
    const r = loadExtension(files)
    if (!r.ok) throw new Error(`extensions/${folder}: ${r.errors.join('; ')}`)
    if (!extHost.has(r.ext.manifest.id)) extHost.enable(r.ext)
  }
}
