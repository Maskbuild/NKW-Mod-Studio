import { create } from 'zustand'
import { api } from '../api'
import { useStore } from '../store'
import i18n from '../i18n'

/** What the side bar shows (activity bar); null = side bar hidden. */
export type SideView = 'library' | 'vanilla' | 'assets' | 'code'

export interface EditorTab {
  id: string
  kind: 'graph' | 'code' | 'model' | 'controls'
  /** generated file path (code) or project asset (model) */
  path?: string
  title: string
  /** model editor: textures wired into the 3D Model node, by slot */
  wired?: (string | null)[]
}

export interface GeneratedFile {
  path: string
  text: string | null
  /** set when the file was edited in the code view: the generator's own text */
  generated?: string
}

const GRAPH: EditorTab = { id: 'graph', kind: 'graph', title: 'Graph' }

/** Layout choices kept between sessions (this viewer only). */
interface Prefs {
  ide: boolean
  side: SideView | null
  panel: boolean
  right: boolean
}
const PREFS_KEY = 'nkw.layout'
function loadPrefs(): Prefs {
  const def: Prefs = { ide: true, side: 'library', panel: true, right: true }
  try {
    return { ...def, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return def
  }
}

interface IdeState extends Prefs {
  tabs: EditorTab[]
  active: string
  /** generated project files of the active target (code view) */
  files: GeneratedFile[]
  filesLoading: boolean
  filesError: string | null
  /** cursor in the code view, for the status bar */
  cursor: { line: number; col: number } | null
  palette: null | 'commands' | 'files'
  /** tabs with unsaved changes (model editor) */
  unsaved: Record<string, boolean>
  setPrefs: (p: Partial<Prefs>) => void
  toggleSide: (v: SideView) => void
  open: (tab: EditorTab) => void
  openCode: (path: string) => void
  openModel: (path: string, wired?: (string | null)[]) => void
  /** the model editor's controls as JSON */
  openControls: () => void
  close: (id: string) => void
  setActive: (id: string) => void
  refreshFiles: () => Promise<void>
}

export const useIde = create<IdeState>((set, get) => ({
  ...loadPrefs(),
  tabs: [GRAPH],
  active: 'graph',
  files: [],
  filesLoading: false,
  filesError: null,
  cursor: null,
  palette: null,
  unsaved: {},
  setPrefs: (p) => {
    set(p)
    const { ide, side, panel, right } = get()
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ide, side, panel, right }))
    } catch {
      /* storage blocked: the layout just isn't remembered */
    }
  },
  toggleSide: (v) => get().setPrefs({ side: get().side === v ? null : v }),
  open: (tab) => {
    const { tabs } = get()
    set({ tabs: tabs.some((t) => t.id === tab.id) ? tabs : [...tabs, tab], active: tab.id })
  },
  openCode: (path) => get().open({ id: `code:${path}`, kind: 'code', path, title: path.split('/').pop() ?? path }),
  openControls: () => get().open({ id: 'controls', kind: 'controls', title: 'model-controls.json' }),
  openModel: (path, wired) => get().open({ id: `model:${path}`, kind: 'model', path, title: path.split('/').pop() ?? path, wired }),
  close: (id) => {
    if (id === 'graph') return
    if (get().unsaved[id] && !window.confirm(i18n.t('model.closeUnsaved'))) return
    const { tabs, active } = get()
    const i = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    const { [id]: _gone, ...unsaved } = get().unsaved
    void _gone
    set({ unsaved, tabs: next, active: active === id ? (next[Math.max(0, i - 1)]?.id ?? 'graph') : active, cursor: active === id ? null : get().cursor })
  },
  setActive: (id) => set({ active: id, cursor: null }),
  refreshFiles: async () => {
    const s = useStore.getState()
    const project = s.project()
    const target = s.targets[s.activeTarget]
    if (!project || !target) return
    set({ filesLoading: true })
    try {
      const files = await api.previewCode(project, target)
      // tabs of files that no longer exist are closed
      const paths = new Set(files.map((f) => f.path))
      const { tabs, active } = get()
      const keep = tabs.filter((t) => t.kind !== 'code' || paths.has(t.path!))
      set({ files, filesError: null, tabs: keep, active: keep.some((t) => t.id === active) ? active : 'graph' })
    } catch (e) {
      set({ filesError: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      set({ filesLoading: false })
    }
  }
}))

/** Keeps the generated files up to date while the code view is in use (debounced after graph changes). */
export function watchGeneratedFiles(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const inUse = () => {
    const i = useIde.getState()
    return i.side === 'code' || i.tabs.some((t) => t.kind === 'code')
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => inUse() && void useIde.getState().refreshFiles(), 700)
  }
  const unsub = useStore.subscribe((s, prev) => {
    const changed =
      s.nodes !== prev.nodes || s.edges !== prev.edges || s.meta !== prev.meta || s.activeTarget !== prev.activeTarget || s.targets !== prev.targets
    // code edits too, so the file list marks edited files (✎)
    if (changed || s.overrides !== prev.overrides) schedule()
  })
  const unsubIde = useIde.subscribe((s, prev) => {
    const was = prev.side === 'code' || prev.tabs.some((t) => t.kind === 'code')
    if (!was && inUse()) void s.refreshFiles()
  })
  if (inUse()) void useIde.getState().refreshFiles()
  return () => {
    clearTimeout(timer)
    unsub()
    unsubIde()
  }
}
