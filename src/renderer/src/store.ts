import type { Edge, Node, XYPosition } from '@xyflow/react'
import { create } from 'zustand'
import { NODE_DEF_MAP, PIN_COLORS, defaultData, pinOf } from '@core/nodes/defs'
import type { Diagnostic } from '@core/ir'
import { toId, type GraphEdge, type GraphNode, type Project, type Target } from '@core/project'
import { api, type AssetEntry, type Settings } from './api'
import type { VanillaData } from '@core/vanilla'

export type NodeData = Record<string, unknown>
export type FlowNode = Node<NodeData>
type Snapshot = { nodes: FlowNode[]; edges: Edge[] }

const HISTORY = 120
let idSeq = Date.now() % 100000

export function newId(prefix = 'n'): string {
  return `${prefix}${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export function edgeStyle(sourceType: string, sourceHandle: string): Edge['style'] {
  const def = NODE_DEF_MAP[sourceType]
  const pin = def ? pinOf(def, sourceHandle, 'out') : undefined
  return { stroke: PIN_COLORS[pin?.type ?? 'any'], strokeWidth: 2.2 }
}

export function toFlow(p: Project): Snapshot {
  const types = new Map(p.graph.nodes.map((n) => [n.id, n.type]))
  return {
    nodes: p.graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      ...(n.type === 'comment' && n.width ? { width: n.width, height: n.height, style: { width: n.width, height: n.height } } : {}),
      ...(n.type === 'comment' ? { zIndex: -1 } : {})
    })),
    edges: p.graph.edges.map((e) => ({ ...e, style: edgeStyle(types.get(e.source) ?? '', e.sourceHandle) }))
  }
}

function fromFlow(nodes: FlowNode[], edges: Edge[]): Project['graph'] {
  return {
    nodes: nodes.map((n): GraphNode => {
      const g: GraphNode = { id: n.id, type: n.type ?? 'comment', position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data }
      if (n.type === 'comment') {
        const w = n.measured?.width ?? n.width
        const h = n.measured?.height ?? n.height
        if (w) g.width = Math.round(w)
        if (h) g.height = Math.round(h)
      }
      return g
    }),
    edges: edges.map((e): GraphEdge => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? 'out', target: e.target, targetHandle: e.targetHandle ?? 'in' }))
  }
}

const strip = (nodes: FlowNode[]): FlowNode[] => nodes.map(({ selected: _s, dragging: _d, ...n }) => n as FlowNode)

export interface BuildState {
  running: boolean
  task: 'runClient' | 'build' | null
  progress: { msg: string; done?: number; total?: number } | null
  logs: string[]
  lastCode: number | null
}

interface State {
  page: 'home' | 'workspace'
  settings: Settings | null
  dir: string | null
  meta: Project['meta'] | null
  targets: Target[]
  activeTarget: number
  nodes: FlowNode[]
  edges: Edge[]
  past: Snapshot[]
  future: Snapshot[]
  dirty: boolean
  saving: boolean
  diagnostics: Diagnostic[]
  issues: Record<string, 'error' | 'warning'>
  assets: AssetEntry[]
  clipboard: Snapshot | null
  build: BuildState
  toasts: { id: number; text: string; err?: boolean }[]
  /** vanilla item data per Minecraft version */
  vanilla: Record<string, VanillaData>

  // actions
  toast(text: string, err?: boolean): void
  setSettings(s: Settings): void
  openProject(dir: string, p: Project): void
  closeProject(): Promise<void>
  project(): Project | null
  setGraph(nodes: FlowNode[], edges: Edge[], record?: boolean): void
  checkpoint(): void
  undo(): void
  redo(): void
  addNode(type: string, pos: XYPosition, data?: NodeData): string
  updateData(id: string, patch: NodeData): void
  setMeta(meta: Project['meta']): void
  setTargets(t: Target[], active?: number): void
  setDiagnostics(d: Diagnostic[]): void
  refreshAssets(): Promise<void>
  /** rewrites node references after assets were renamed/moved */
  remapAssets(changes: { from: string; to: string }[]): void
  /** clears node references to deleted assets */
  dropAssets(paths: string[]): void
  save(): Promise<void>
  copy(): void
  paste(at?: XYPosition): void
  duplicate(): void
  appendLogs(lines: string[]): void
  setBuild(p: Partial<BuildState>): void
}

let editBurst: { key: string; at: number } | null = null

export const useStore = create<State>((set, get) => ({
  page: 'home',
  settings: null,
  dir: null,
  meta: null,
  targets: [],
  activeTarget: 0,
  nodes: [],
  edges: [],
  past: [],
  future: [],
  dirty: false,
  saving: false,
  diagnostics: [],
  issues: {},
  assets: [],
  clipboard: null,
  build: { running: false, task: null, progress: null, logs: [], lastCode: null },
  toasts: [],
  vanilla: {},

  toast(text, err) {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts, { id, text, err }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), err ? 5200 : 2600)
  },
  setSettings(settings) {
    set({ settings })
  },
  openProject(dir, p) {
    const f = toFlow(p)
    set({
      page: 'workspace',
      dir,
      meta: p.meta,
      targets: p.targets,
      activeTarget: Math.min(p.activeTarget, p.targets.length - 1),
      nodes: f.nodes,
      edges: f.edges,
      past: [],
      future: [],
      dirty: false,
      diagnostics: [],
      issues: {},
      build: { running: false, task: null, progress: null, logs: [], lastCode: null }
    })
    void get().refreshAssets()
  },
  async closeProject() {
    if (get().dirty) await get().save()
    await api.closeProject()
    set({ page: 'home', dir: null, meta: null, nodes: [], edges: [], past: [], future: [] })
    set({ settings: await api.settings() })
  },
  project() {
    const s = get()
    if (!s.meta) return null
    return { schemaVersion: 1, meta: s.meta, targets: s.targets, activeTarget: s.activeTarget, graph: fromFlow(s.nodes, s.edges) }
  },
  setGraph(nodes, edges, record = false) {
    if (record) get().checkpoint()
    set({ nodes, edges, dirty: true })
  },
  checkpoint() {
    const s = get()
    set({ past: [...s.past.slice(-HISTORY + 1), { nodes: strip(s.nodes), edges: s.edges }], future: [] })
  },
  undo() {
    const s = get()
    const prev = s.past[s.past.length - 1]
    if (!prev) return
    set({ past: s.past.slice(0, -1), future: [{ nodes: strip(s.nodes), edges: s.edges }, ...s.future], nodes: prev.nodes, edges: prev.edges, dirty: true })
  },
  redo() {
    const s = get()
    const next = s.future[0]
    if (!next) return
    set({ future: s.future.slice(1), past: [...s.past, { nodes: strip(s.nodes), edges: s.edges }], nodes: next.nodes, edges: next.edges, dirty: true })
  },
  addNode(type, pos, data) {
    const def = NODE_DEF_MAP[type]
    const id = newId()
    get().checkpoint()
    const node: FlowNode = {
      id,
      type,
      position: pos,
      data: { ...defaultData(def), ...data },
      selected: true,
      ...(type === 'comment' ? { style: { width: 360, height: 200 }, width: 360, height: 200, zIndex: -1 } : {})
    }
    // make registry ids unique
    if (def.registers) {
      const key = def.props.some((p) => p.key === 'id') ? 'id' : def.props.some((p) => p.key === 'baseId') ? 'baseId' : null
      if (key) node.data[key] = uniqueId(get().nodes, key, String(node.data[key]))
    }
    set((s) => ({ nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node], dirty: true }))
    return id
  },
  updateData(id, patch) {
    const key = `${id}:${Object.keys(patch).join(',')}`
    const now = Date.now()
    if (!editBurst || editBurst.key !== key || now - editBurst.at > 800) get().checkpoint()
    editBurst = { key, at: now }
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), dirty: true }))
  },
  setMeta(meta) {
    set({ meta, dirty: true })
  },
  setTargets(targets, active) {
    set((s) => ({ targets, activeTarget: Math.min(active ?? s.activeTarget, targets.length - 1), dirty: true }))
  },
  setDiagnostics(diagnostics) {
    const issues: Record<string, 'error' | 'warning'> = {}
    for (const d of diagnostics) if (d.nodeId && issues[d.nodeId] !== 'error') issues[d.nodeId] = d.severity
    set({ diagnostics, issues })
  },
  async refreshAssets() {
    try {
      set({ assets: await api.listAssets() })
    } catch {
      /* project closed */
    }
  },
  remapAssets(changes) {
    if (!changes.length) return
    const map = new Map(changes.map((ch) => [ch.from, ch.to]))
    get().checkpoint()
    const nodes = get().nodes.map((n) => {
      let hit = false
      const data = Object.fromEntries(Object.entries(n.data).map(([k, v]) => (typeof v === 'string' && map.has(v) ? ((hit = true), [k, map.get(v)!]) : [k, v])))
      return hit ? { ...n, data } : n
    })
    set({ nodes, dirty: true })
  },
  dropAssets(paths) {
    if (!paths.length) return
    const gone = new Set(paths)
    const nodes = get().nodes.map((n) => (typeof n.data.asset === 'string' && gone.has(n.data.asset) ? { ...n, data: { ...n.data, asset: '' } } : n))
    set({ nodes, dirty: true })
  },
  async save() {
    const p = get().project()
    if (!p || get().saving) return
    set({ saving: true })
    try {
      await api.saveProject(p)
      set({ dirty: false })
    } catch (e) {
      get().toast(String((e as Error).message ?? e), true)
    } finally {
      set({ saving: false })
    }
  },
  copy() {
    const s = get()
    const nodes = s.nodes.filter((n) => n.selected)
    const ids = new Set(nodes.map((n) => n.id))
    set({ clipboard: { nodes: strip(nodes), edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) } })
  },
  paste(at) {
    const clip = get().clipboard
    if (!clip || !clip.nodes.length) return
    get().checkpoint()
    const minX = Math.min(...clip.nodes.map((n) => n.position.x))
    const minY = Math.min(...clip.nodes.map((n) => n.position.y))
    const off = at ? { x: at.x - minX, y: at.y - minY } : { x: 40, y: 40 }
    const map = new Map<string, string>()
    let all: FlowNode[] = get().nodes.map((n) => ({ ...n, selected: false }))
    const added: FlowNode[] = []
    for (const n of clip.nodes) {
      const id = newId()
      map.set(n.id, id)
      const data = { ...n.data }
      const def = NODE_DEF_MAP[n.type ?? '']
      if (def?.registers) for (const k of ['id', 'baseId']) if (typeof data[k] === 'string') data[k] = uniqueId([...all, ...added], k, data[k] as string)
      added.push({ ...n, id, data, selected: true, position: { x: n.position.x + off.x, y: n.position.y + off.y } })
    }
    all = [...all, ...added]
    const edges = [
      ...get().edges,
      ...clip.edges.map((e) => ({ ...e, id: newId('e'), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }))
    ]
    set({ nodes: all, edges, dirty: true })
  },
  duplicate() {
    get().copy()
    get().paste()
  },
  appendLogs(lines) {
    set((s) => {
      const logs = s.build.logs.length + lines.length > 6000 ? [...s.build.logs.slice(-(6000 - lines.length)), ...lines] : [...s.build.logs, ...lines]
      return { build: { ...s.build, logs } }
    })
  },
  setBuild(p) {
    set((s) => ({ build: { ...s.build, ...p } }))
  }
}))

function uniqueId(nodes: FlowNode[], key: string, base: string): string {
  const used = new Set(nodes.map((n) => n.data[key]).filter((v): v is string => typeof v === 'string'))
  if (!used.has(base)) return base
  const stem = toId(base.replace(/_\d+$/, ''))
  for (let i = 2; ; i++) if (!used.has(`${stem}_${i}`)) return `${stem}_${i}`
}
