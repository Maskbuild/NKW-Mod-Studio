import { extHost } from './host'
import { loadExtension } from './manifest'

/** The text files of extensions that are on (from the app's main process), by extension id. */
export type ExtBundle = { id: string; files: Record<string, string> }[]

/** ids this module turned on (so a changed bundle can turn them off again) */
const mine = new Set<string>()

/**
 * Makes the extensions of this process (renderer, worker) match a bundle. Extensions that are already on and
 * were not turned on here (the ones the app ships while it is developed) are left alone. Returns problems.
 */
export function applyBundle(bundle: ExtBundle): { id: string; errors: string[] }[] {
  for (const id of mine) extHost.disable(id)
  mine.clear()
  const problems: { id: string; errors: string[] }[] = []
  for (const item of bundle) {
    if (extHost.has(item.id)) continue
    const r = loadExtension(new Map(Object.entries(item.files)))
    if (!r.ok) {
      problems.push({ id: item.id, errors: r.errors })
      continue
    }
    try {
      extHost.enable(r.ext)
      mine.add(item.id)
    } catch (e) {
      problems.push({ id: item.id, errors: [(e as Error).message] })
    }
  }
  return problems
}
