import type { Edge, Node, XYPosition } from '@xyflow/react'
import { parseJavacError } from '@core/scriptApi'
import { create } from 'zustand'
import { NODE_DEF_MAP, PIN_COLORS, defaultData, pinOf } from '@core/nodes/defs'
import type { Diagnostic } from '@core/ir'
import { toId, type LinkedMod, type GraphEdge, type GraphNode, type Project, type Target } from '@core/project'
import { api, type AssetEntry, type Settings } from './api'
import type { VanillaData } from '@core/vanilla'

export type NodeData = Record<string, unknown>
export type FlowNode = Node<NodeData>
type Snapshot = { nodes: FlowNode[]; edges: Edge[] }

const HISTORY = 120
let idSeq = Date.now() % 100000
/** the save in progress (see save) */
let pendingSave: Promise<void> | null = null

export function newId(prefix = 'n'): string {
  return `${prefix}${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** The node a wire really comes from, following reroute nodes (undefined if none / a loop). */
export function wireSource(nodes: FlowNode[], edges: Edge[], edge: Edge | undefined): FlowNode | undefined {
  for (let i = 0; edge && i < 64; i++) {
    const from = edge.source
    const n = nodes.find((x) => x.id === from)
    if (n?.type !== 'reroute') return n
    edge = edges.find((x) => x.target === n.id && x.targetHandle === 'in')
  }
  return undefined
}

/** The node plugged into input `handle` of `target` (reroutes followed). */
export const inputSource = (nodes: FlowNode[], edges: Edge[], target: string, handle: string) =>
  wireSource(
    nodes,
    edges,
    edges.find((x) => x.target === target && x.targetHandle === handle)
  )

export function edgeStyle(sourceType: string, sourceHandle: string): Edge['style'] {
  const def = NODE_DEF_MAP[sourceType]
  const pin = def ? pinOf(def, sourceHandle, 'out') : undefined
  return { stroke: PIN_COLORS[pin?.type ?? 'any'], strokeWidth: 2.2 }
}

function toFlow(p: Project): Snapshot {
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
    edges: edges.map((e): GraphEdge => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? 'out',
      target: e.target,
      targetHandle: e.targetHandle ?? 'in'
    }))
  }
}

const strip = (nodes: FlowNode[]): FlowNode[] => nodes.map(({ selected: _s, dragging: _d, ...n }) => n as FlowNode)

export interface BuildState {
  running: boolean
  task: 'runClient' | 'build' | 'compileJava' | null
  progress: { msg: string; done?: number; total?: number } | null
  logs: string[]
  lastCode: number | null
  /** javac errors of Script classes from the last build (file class, line, message) */
  javaErrors: { cls: string; line: number; message: string; severity: 'error' | 'warning' }[]
}

interface State {
  page: 'home' | 'workspace'
  settings: Settings | null
  dir: string | null
  meta: Project['meta'] | null
  targets: Target[]
  /** generated files edited in the code view (Project.overrides) */
  overrides: Record<string, string>
  /** other mods linked to the project (Modrinth or .jar files): their items show in the editor */
  mods: LinkedMod[]
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
  /** edits (text) or reverts (null) a generated file of a target */
  setMods(mods: LinkedMod[]): void
  setOverride(key: string, text: string | null): void
  setTargets(t: Target[], active?: number): void
  setDiagnostics(d: Diagnostic[]): void
  refreshAssets(): Promise<void>
  /** rewrites node references after assets were renamed/moved */
  remapAssets(changes: { from: string; to: string }[]): void
  /** clears node references to deleted assets */
  dropAssets(paths: string[]): void
  save(): Promise<void>
  copy(): string | null
  paste(at?: XYPosition, text?: string): boolean
  cut(): string | null
  duplicate(): void
  /** disables the selected nodes (or the given ones), or enables them when all are already disabled */
  toggleDisabled(ids?: string[]): void
  /** removes these wires (undoable) */
  disconnect(edgeIds: string[]): void
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
  overrides: {},
  mods: [],
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
  build: { running: false, task: null, progress: null, logs: [], lastCode: null, javaErrors: [] },
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
      overrides: p.overrides ?? {},
      mods: p.mods ?? [],
      activeTarget: Math.min(p.activeTarget, p.targets.length - 1),
      nodes: f.nodes,
      edges: f.edges,
      past: [],
      future: [],
      dirty: false,
      diagnostics: [],
      issues: {},
      build: { running: false, task: null, progress: null, logs: [], lastCode: null, javaErrors: [] }
    })
    void get().refreshAssets()
  },
  async closeProject() {
    if (get().dirty) await get().save()
    // a failed save keeps the project open, so nothing is lost
    if (get().dirty) return
    await api.closeProject()
    set({ page: 'home', dir: null, meta: null, nodes: [], edges: [], past: [], future: [] })
    set({ settings: await api.settings() })
  },
  project() {
    const s = get()
    if (!s.meta) return null
    return {
      schemaVersion: 1,
      meta: s.meta,
      targets: s.targets,
      activeTarget: s.activeTarget,
      graph: fromFlow(s.nodes, s.edges),
      ...(Object.keys(s.overrides).length ? { overrides: s.overrides } : {}),
      ...(s.mods.length ? { mods: s.mods } : {})
    }
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
  setMods(mods) {
    set({ mods, dirty: true })
  },
  setOverride(key, text) {
    set((s) => {
      const overrides = { ...s.overrides }
      if (text === null) delete overrides[key]
      else overrides[key] = text
      return { overrides, dirty: true }
    })
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
    // one save at a time: a second call waits for the running one, then saves what changed meanwhile
    while (pendingSave) await pendingSave
    const p = get().project()
    if (!p) return
    const before = get()
    const run = (async () => {
      set({ saving: true })
      try {
        await api.saveProject(p)
        // edits made while saving stay unsaved
        const s = get()
        const same =
          s.nodes === before.nodes &&
          s.edges === before.edges &&
          s.meta === before.meta &&
          s.targets === before.targets &&
          s.activeTarget === before.activeTarget &&
          s.overrides === before.overrides &&
          s.mods === before.mods
        if (same) set({ dirty: false })
      } catch (e) {
        get().toast(String((e as Error).message ?? e), true)
      } finally {
        set({ saving: false })
      }
    })()
    pendingSave = run
    try {
      await run
    } finally {
      if (pendingSave === run) pendingSave = null
    }
  },
  copy() {
    const s = get()
    const nodes = s.nodes.filter((n) => n.selected)
    if (!nodes.length) return null
    const ids = new Set(nodes.map((n) => n.id))
    const clip = { nodes: strip(nodes), edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }
    set({ clipboard: clip })
    // also as text on the system clipboard, so nodes paste into other projects too
    return JSON.stringify({ nkwNodes: 1, ...clip })
  },
  cut() {
    const text = get().copy()
    if (!text) return null
    const s = get()
    const ids = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id))
    s.checkpoint()
    s.setGraph(
      s.nodes.filter((n) => !ids.has(n.id)),
      s.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
    )
    return text
  },
  paste(at, text) {
    let clip = get().clipboard
    if (text !== undefined) {
      // nodes copied as text (this or another project / window); other text is not ours
      try {
        const parsed = JSON.parse(text) as { nkwNodes?: number; nodes?: unknown; edges?: unknown }
        if (parsed?.nkwNodes !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return false
        const known = (parsed.nodes as FlowNode[]).filter(
          (n) =>
            n &&
            typeof n.id === 'string' &&
            typeof n.type === 'string' &&
            (NODE_DEF_MAP[n.type] || n.type === 'comment' || n.type === 'reroute') &&
            Number.isFinite(n.position?.x) &&
            Number.isFinite(n.position?.y) &&
            !!n.data &&
            typeof n.data === 'object' &&
            !Array.isArray(n.data)
        )
        const keep = new Set(known.map((n) => n.id))
        clip = { nodes: known, edges: (parsed.edges as Snapshot['edges']).filter((e) => e && keep.has(e.source) && keep.has(e.target)) }
      } catch {
        return false
      }
    }
    if (!clip || !clip.nodes.length) return false
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
    return true
  },
  disconnect(edgeIds) {
    const s = get()
    const drop = new Set(edgeIds)
    if (!s.edges.some((e) => drop.has(e.id))) return
    s.checkpoint()
    s.setGraph(
      s.nodes,
      s.edges.filter((e) => !drop.has(e.id))
    )
  },
  toggleDisabled(ids) {
    const s = get()
    const pick = new Set(ids ?? s.nodes.filter((n) => n.selected).map((n) => n.id))
    const targets = s.nodes.filter((n) => pick.has(n.id) && n.type !== 'comment')
    if (!targets.length) return
    const disable = targets.some((n) => !n.data.disabled)
    s.checkpoint()
    s.setGraph(
      s.nodes.map((n) => (pick.has(n.id) && n.type !== 'comment' ? { ...n, data: { ...n.data, disabled: disable || undefined } } : n)),
      s.edges
    )
  },
  duplicate() {
    get().copy()
    get().paste()
  },
  appendLogs(lines) {
    set((s) => {
      const logs = s.build.logs.length + lines.length > 6000 ? [...s.build.logs.slice(-(6000 - lines.length)), ...lines] : [...s.build.logs, ...lines]
      // javac errors of Script files are shown in their editor
      const found = lines
        .map(parseJavacError)
        .filter((e): e is NonNullable<typeof e> => !!e)
        .filter((e) => !s.build.javaErrors.some((x) => x.cls === e.cls && x.line === e.line && x.message === e.message))
      return { build: { ...s.build, logs, javaErrors: found.length ? [...s.build.javaErrors, ...found].slice(-200) : s.build.javaErrors } }
    })
  },
  setBuild(p) {
    // a new build starts with no javac errors
    set((s) => ({ build: { ...s.build, ...(p.running ? { javaErrors: [] } : {}), ...p } }))
  }
}))

function uniqueId(nodes: FlowNode[], key: string, base: string): string {
  const used = new Set(nodes.map((n) => n.data[key]).filter((v): v is string => typeof v === 'string'))
  if (!used.has(base)) return base
  const stem = toId(base.replace(/_\d+$/, ''))
  for (let i = 2; ; i++) if (!used.has(`${stem}_${i}`)) return `${stem}_${i}`
}
