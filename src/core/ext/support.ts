import type { Manifest } from './manifest'
import { eraMatches } from './tpl'

/** Does the extension's `targets` allow this loader and Minecraft version? */
export function extensionSupports(m: Pick<Manifest, 'targets'>, loader: string, mc: string): boolean {
  const t = m.targets
  if (t.loaders && !t.loaders.includes(loader as never)) return false
  return !t.mc || eraMatches(t.mc, mc)
}

/** The first `targetConfig` entry that fits this loader and version (its values), or null. */
export function targetConfigFor(m: Pick<Manifest, 'targetConfig'>, loader: string, mc: string): Record<string, string | number | boolean> | null {
  for (const c of m.targetConfig) {
    if (c.loaders && !c.loaders.includes(loader as never)) continue
    if (c.mc && !eraMatches(c.mc, mc)) continue
    return c.values
  }
  return null
}
