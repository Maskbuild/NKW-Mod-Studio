import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeChange,
  type OnConnectStartParams
} from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { NODE_DEF_MAP, canConnect, pinOf } from '@core/nodes/defs'
import { edgeStyle, newId, useStore, type FlowNode } from '../store'
import { NODE_TYPES, CATEGORY_COLOR } from './NodeView'
import { EDGE_TYPES } from './WireEdge'
import { L } from '../i18n'
import { QuickAdd, matchPin, type Pending } from './QuickAdd'
import { IBan, ICopy, IFit, ITrash, IX } from '../components/Icons'
import { NODE_FOR_KIND, addImportedNodes, hasFiles, importDropped } from '../drop'
import type { AssetKind } from '../api'

const pinType = (nodes: FlowNode[], nodeId: string, handle: string | null, dir: 'in' | 'out') => {
  const n = nodes.find((x) => x.id === nodeId)
  const def = n && NODE_DEF_MAP[n.type ?? '']
  return def && handle ? pinOf(def, handle, dir)?.type : undefined
}

/** Adds an edge, replacing whatever was plugged into the same input (inputs take one wire). */
export function connect(edges: Edge[], nodes: FlowNode[], c: Connection): Edge[] {
  const src = nodes.find((n) => n.id === c.source)
  const tgt = nodes.find((n) => n.id === c.target)
  const tdef = tgt && NODE_DEF_MAP[tgt.type ?? '']
  const isMulti = !!(tdef && c.targetHandle && pinOf(tdef, c.targetHandle, 'in')?.multi)
  // multi inputs collect wires (ignoring exact duplicates); normal inputs take a single wire
  const rest = isMulti
    ? edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle && e.source === c.source && e.sourceHandle === c.sourceHandle))
    : edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
  return [
    ...rest,
    {
      id: newId('e'),
      source: c.source,
      target: c.target,
      sourceHandle: c.sourceHandle,
      targetHandle: c.targetHandle,
      style: edgeStyle(src?.type ?? '', c.sourceHandle ?? '')
    }
  ]
}

export function Canvas({ quickAddRef }: { quickAddRef: React.MutableRefObject<((x: number, y: number) => void) | null> }) {
  const { t } = useTranslation()
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const rf = useReactFlow()
  const [qa, setQa] = useState<{ x: number; y: number; pending: Pending | null } | null>(null)
  const connecting = useRef<OnConnectStartParams | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const rightDown = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    quickAddRef.current = (x, y) => setQa({ x, y, pending: null })
  }, [quickAddRef])

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const s = useStore.getState()
    if (changes.some((c) => c.type === 'remove')) s.checkpoint()
    const next = applyNodeChanges(changes, s.nodes)
    const meaningful = changes.some(
      (c) => c.type === 'remove' || c.type === 'add' || (c.type === 'position' && !c.dragging) || (c.type === 'dimensions' && c.resizing)
    )
    if (meaningful)
      s.setGraph(
        next,
        s.edges.filter((e) => next.some((n) => n.id === e.source) && next.some((n) => n.id === e.target))
      )
    else useStore.setState({ nodes: next })
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const s = useStore.getState()
    const removing = changes.some((c) => c.type === 'remove')
    if (removing) s.checkpoint()
    const next = applyEdgeChanges(changes, s.edges)
    if (removing) s.setGraph(s.nodes, next)
    else useStore.setState({ edges: next })
  }, [])

  const onConnect = useCallback((c: Connection) => {
    const s = useStore.getState()
    s.checkpoint()
    s.setGraph(s.nodes, connect(s.edges, s.nodes, c))
  }, [])

  const isValidConnection: IsValidConnection = useCallback((c) => {
    if (c.source === c.target) return false
    const ns = useStore.getState().nodes
    const a = pinType(ns, c.source, c.sourceHandle ?? null, 'out')
    const b = pinType(ns, c.target, c.targetHandle ?? null, 'in')
    return !!a && !!b && canConnect(a, b)
  }, [])

  const onConnectStart = useCallback((_: unknown, p: OnConnectStartParams) => {
    connecting.current = p
  }, [])

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const start = connecting.current
    connecting.current = null
    if (state.isValid || state.toNode || !start?.nodeId || !start.handleId) return
    const dir = start.handleType === 'source' ? 'out' : 'in'
    const type = pinType(useStore.getState().nodes, start.nodeId, start.handleId, dir)
    if (!type) return
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event
    setQa({ x: pt.clientX, y: pt.clientY, pending: { type, dir, nodeId: start.nodeId, handle: start.handleId } })
  }, [])

  const pick = (type: string) => {
    if (!qa) return
    const pos = rf.screenToFlowPosition({ x: qa.x, y: qa.y })
    const s = useStore.getState()
    const p = qa.pending
    const def = NODE_DEF_MAP[type]
    const id = s.addNode(type, p && p.dir === 'in' ? { x: pos.x - 250, y: pos.y - 20 } : { x: pos.x, y: pos.y - 20 })
    if (p) {
      const handle = matchPin(def, p)
      if (handle) {
        const c: Connection =
          p.dir === 'out'
            ? { source: p.nodeId, sourceHandle: p.handle, target: id, targetHandle: handle }
            : { source: id, sourceHandle: handle, target: p.nodeId, targetHandle: p.handle }
        const st = useStore.getState()
        useStore.setState({ edges: connect(st.edges, st.nodes, c) })
      }
    }
    setQa(null)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/nkw-node')
    const asset = e.dataTransfer.getData('application/nkw-asset')
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const vanilla = e.dataTransfer.getData('application/nkw-vanilla')
    const tag = e.dataTransfer.getData('application/nkw-tag')
    if (type && NODE_DEF_MAP[type]) useStore.getState().addNode(type, pos)
    else if (vanilla) useStore.getState().addNode('itemRef', pos, { item: vanilla })
    else if (tag) useStore.getState().addNode('tagRef', pos, { tag })
    else if (asset) {
      const [kind, path] = asset.split('|') as [AssetKind, string]
      useStore.getState().addNode(NODE_FOR_KIND[kind] ?? 'texture', pos, { asset: path })
    } else if (hasFiles(e)) {
      const files = Array.from(e.dataTransfer.files)
      void importDropped(files).then((imported) => addImportedNodes(imported, pos))
    }
  }

  const onPaneContextMenu = (e: RMouseEvent | globalThis.MouseEvent) => {
    e.preventDefault()
    // right-drag pans the canvas; only a right *click* opens the add menu
    const d = rightDown.current
    rightDown.current = null
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return
    setMenu(null)
    setQa({ x: e.clientX, y: e.clientY, pending: null })
  }

  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** "Pin ← other node" labels for the wires of the node the menu was opened on. */
  const wiresOf = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    const def = node && NODE_DEF_MAP[node.type ?? '']
    if (!def) return []
    return edges
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .map((e) => {
        const incoming = e.target === nodeId
        const pin = pinOf(def, (incoming ? e.targetHandle : e.sourceHandle) ?? '', incoming ? 'in' : 'out')
        const other = nodes.find((n) => n.id === (incoming ? e.source : e.target))
        const odef = other && NODE_DEF_MAP[other.type ?? '']
        const oname = other ? (typeof other.data.name === 'string' && other.data.name ? other.data.name : odef ? L(odef.title) : '?') : '?'
        const opin = odef && pinOf(odef, (incoming ? e.sourceHandle : e.targetHandle) ?? '', incoming ? 'out' : 'in')
        return { id: e.id, label: `${pin ? L(pin.label) : '?'} ${incoming ? '←' : '→'} ${oname}${opin ? ` · ${L(opin.label)}` : ''}` }
      })
  }
  const nodeAction = (action: 'duplicate' | 'delete' | 'disconnect' | 'disable' | 'copy') => {
    if (!menu) return
    const s = useStore.getState()
    useStore.setState({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === menu.id || (n.selected && s.nodes.find((x) => x.id === menu.id)?.selected) || false }))
    })
    const ids = new Set(
      useStore
        .getState()
        .nodes.filter((n) => n.selected)
        .map((n) => n.id)
    )
    if (action === 'duplicate') s.duplicate()
    // like Ctrl+C: the copy event also puts the nodes on the system clipboard
    else if (action === 'copy') {
      if (!document.execCommand('copy')) s.copy()
    } else if (action === 'disable') s.toggleDisabled([...ids])
    else {
      s.checkpoint()
      const st = useStore.getState()
      const edges = st.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
      s.setGraph(action === 'delete' ? st.nodes.filter((n) => !ids.has(n.id)) : st.nodes, edges)
    }
    setMenu(null)
  }

  return (
    <div
      className="canvas"
      ref={wrap}
      onPointerDownCapture={(e) => {
        if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY }
      }}
      onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'))}
      onDrop={onDrop}
    >
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStart={() => useStore.getState().checkpoint()}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={(e, n) => {
          e.preventDefault()
          setQa(null)
          setMenu({ x: e.clientX, y: e.clientY, id: n.id })
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault()
          setQa(null)
          setMenu(null)
          setEdgeMenu({ x: e.clientX, y: e.clientY, id: edge.id })
        }}
        onPaneClick={() => (setMenu(null), setEdgeMenu(null))}
        onlyRenderVisibleElements
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.15}
        maxZoom={2.5}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        selectNodesOnDrag={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'default' }}
        connectionLineStyle={{ strokeWidth: 2.2, stroke: 'var(--muted)' }}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.4} color="var(--grid)" />
        <MiniMap
          pannable
          zoomable
          style={{ width: 170, height: 110 }}
          nodeColor={(n) => CATEGORY_COLOR[NODE_DEF_MAP[n.type ?? '']?.category ?? 'util']}
          nodeBorderRadius={6}
        />
        <Controls showInteractive={false}>
          <ControlButton onClick={() => rf.fitView({ padding: 0.2, duration: 300 })} title={t('ws.fit')}>
            <IFit size={14} />
          </ControlButton>
        </Controls>
      </ReactFlow>
      {/* each tip shows for a few seconds, then fades out by itself (a new tip starts again) */}
      <div key={nodes.length < 3 ? 'tips' : 'selTip'} className="canvas-tip fade">
        {nodes.length < 3 ? t('ws.tips') : t('ws.selTip')}
      </div>
      {qa && (
        <QuickAdd
          x={qa.x}
          y={qa.y}
          pending={qa.pending}
          onPick={pick}
          onClose={() => setQa(null)}
          onPaste={
            !qa.pending && useStore.getState().clipboard?.nodes.length
              ? () => {
                  useStore.getState().paste(rf.screenToFlowPosition({ x: qa.x, y: qa.y }))
                  setQa(null)
                }
              : undefined
          }
        />
      )}
      {menu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => (e.preventDefault(), setMenu(null))}
          />
          <div
            className="qa ctx"
            style={{
              left: Math.min(menu.x, window.innerWidth - 210),
              top: Math.min(menu.y, window.innerHeight - 180 - Math.min(8, wiresOf(menu.id).length) * 30)
            }}
            role="menu"
          >
            <div className="qa-item" role="menuitem" onMouseDown={() => nodeAction('copy')}>
              <ICopy size={14} /> {t('ws.copy')} <small>Ctrl+C</small>
            </div>
            <div className="qa-item" role="menuitem" onMouseDown={() => nodeAction('duplicate')}>
              <ICopy size={14} /> {t('ws.duplicate')} <small>Ctrl+D</small>
            </div>
            <div className="qa-item" role="menuitem" onMouseDown={() => nodeAction('disable')}>
              <IBan size={14} /> {nodes.find((n) => n.id === menu.id)?.data.disabled ? t('ws.enable') : t('ws.disable')} <small>Ctrl+E</small>
            </div>
            {wiresOf(menu.id).length > 0 && (
              <>
                <div className="qa-sep">{t('ws.wires')}</div>
                <div className="qa-wires">
                  {wiresOf(menu.id).map((w) => (
                    <div
                      key={w.id}
                      className="qa-item wire-item"
                      role="menuitem"
                      title={t('ws.disconnectOne')}
                      onMouseDown={() => {
                        useStore.getState().disconnect([w.id])
                        setMenu(null)
                      }}
                    >
                      <IX size={12} /> <span className="ellipsis">{w.label}</span>
                    </div>
                  ))}
                </div>
                <div className="qa-item" role="menuitem" onMouseDown={() => nodeAction('disconnect')}>
                  <IX size={14} /> {t('ws.disconnect')}
                </div>
              </>
            )}
            <div className="qa-item danger" role="menuitem" onMouseDown={() => nodeAction('delete')}>
              <ITrash size={14} /> {t('ws.delete')} <small>Del</small>
            </div>
          </div>
        </>
      )}
      {edgeMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
            onMouseDown={() => setEdgeMenu(null)}
            onContextMenu={(e) => (e.preventDefault(), setEdgeMenu(null))}
          />
          <div
            className="qa ctx"
            style={{ left: Math.min(edgeMenu.x, window.innerWidth - 210), top: Math.min(edgeMenu.y, window.innerHeight - 60) }}
            role="menu"
          >
            <div
              className="qa-item danger"
              role="menuitem"
              onMouseDown={() => {
                useStore.getState().disconnect([edgeMenu.id])
                setEdgeMenu(null)
              }}
            >
              <IX size={14} /> {t('ws.disconnectOne')} <small>Del</small>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
