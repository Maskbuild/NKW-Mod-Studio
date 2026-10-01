import type { XYPosition } from '@xyflow/react'
import i18n from './i18n'
import { api, type AssetKind, type ImportedAsset } from './api'
import { edgeStyle, newId, useStore, type FlowNode } from './store'

export const NODE_FOR_KIND: Record<AssetKind, string> = {
  texture: 'texture',
  model: 'model',
  geo: 'geoModel',
  sound: 'soundFile',
  animation: 'animation'
}

/** True when a drag event carries files from the operating system. */
export function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/** Imports dropped OS files into the project (type detected from content) and reports problems. */
export async function importDropped(files: File[], kind?: AssetKind, folder?: string): Promise<ImportedAsset[]> {
  const s = useStore.getState()
  if (!s.dir || !files.length) return []
  try {
    const r = await api.importFiles(files, kind, folder)
    for (const e of r.errors) s.toast(e, true)
    for (const a of r.imported) if (a.warning) s.toast(`${a.name}: ${a.warning}`)
    await s.refreshAssets()
    return r.imported
  } catch (e) {
    s.toast((e as Error).message, true)
    return []
  }
}

/** Node data for a freshly imported asset. */
function dataFor(a: ImportedAsset): Record<string, unknown> {
  const d: Record<string, unknown> = { asset: a.asset }
  if (a.textureSlots) d.textureSlots = a.textureSlots
  if (a.animations?.length) d.anim = a.animations[0]
  if (a.seconds) d.seconds = a.seconds
  return d
}

/**
 * Creates nodes for imported assets at `pos`. Textures that came out of a .bbmodel are placed next
 * to (and wired into) their model instead of becoming loose nodes.
 */
export function addImportedNodes(imported: ImportedAsset[], pos: XYPosition): void {
  if (!imported.length) return
  const s = useStore.getState()
  s.checkpoint()
  const nodes: FlowNode[] = s.nodes.map((n) => ({ ...n, selected: false }))
  const edges = [...s.edges]
  const owned = new Set(imported.flatMap((a) => a.textures ?? []))
  let y = pos.y
  for (const a of imported) {
    if (owned.has(a.asset)) continue
    const id = newId()
    nodes.push({ id, type: NODE_FOR_KIND[a.kind], position: { x: pos.x, y }, data: dataFor(a), selected: true })
    ;(a.textures ?? []).slice(0, a.kind === 'geo' ? 1 : 4).forEach((tex, i) => {
      if (!tex) return
      const handle = a.kind === 'geo' ? 'texture' : `tex${i}`
      const tid = newId()
      nodes.push({ id: tid, type: 'texture', position: { x: pos.x - 280, y: y + i * 110 }, data: { asset: tex } })
      edges.push({ id: newId('e'), source: tid, sourceHandle: 'out', target: id, targetHandle: handle, style: edgeStyle('texture', 'out') })
    })
    y += Math.max(130, (a.textures?.length ?? 0) * 110)
  }
  s.setGraph(nodes, edges)
  s.toast(i18n.language === 'th' ? `นำเข้าแล้ว ${imported.length} ไฟล์` : `Imported ${imported.length} file(s)`)
}
