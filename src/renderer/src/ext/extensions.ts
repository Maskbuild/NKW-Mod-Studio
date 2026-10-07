import { applyBundle, type ExtBundle } from '@core/ext/bundle'
import { api } from '../api'

/** The extensions that are on, as the app's main process has them. Also handed to the validation worker. */
let current: ExtBundle = []
const listeners = new Set<(b: ExtBundle) => void>()

export const currentBundle = () => current
export const onBundleChange = (fn: (b: ExtBundle) => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Reads what is installed and turns it on here (nodes appear / disappear in the editor). */
export async function refreshExtensions(): Promise<void> {
  current = await api.extBundle()
  applyBundle(current)
  for (const fn of [...listeners]) fn(current)
}
