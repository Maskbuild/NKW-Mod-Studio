import { extHost } from './host'
import { registry } from './registry'

/**
 * Node types that older versions of the app had built in and that now come from an extension. A project
 * that still holds such a node knows which extension it needs even when that extension is not installed.
 */
export const LEGACY_NODE_EXTENSION: Record<string, string> = {
  breakRule: 'roleplay',
  regenBlock: 'roleplay',
  gameCrop: 'roleplay',
  harvestUi: 'roleplay',
  thirst: 'thirst',
  fdCutting: 'farmers-delight',
  fdCooking: 'farmers-delight'
}

/** The extension a node type comes from (also when it is not installed), or null for the app's own nodes. */
export function extensionOfType(type: string): string | null {
  const src = registry.sourceOf(type)
  if (src?.startsWith('ext:')) return src.slice(4)
  return src ? null : (LEGACY_NODE_EXTENSION[type] ?? null)
}

/** The extensions a graph uses, with the version that is installed here (what a project file remembers). */
export function usedExtensions(nodes: { type: string }[]): { id: string; version?: string }[] {
  const ids = new Set<string>()
  const seen = new Set<string>()
  for (const n of nodes) {
    if (seen.has(n.type)) continue
    seen.add(n.type)
    const id = extensionOfType(n.type)
    if (id) ids.add(id)
  }
  return [...ids].sort().map((id) => ({ id, ...(extHost.get(id) ? { version: extHost.get(id)!.manifest.version } : {}) }))
}
