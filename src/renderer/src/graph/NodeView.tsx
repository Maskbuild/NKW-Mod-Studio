import { memo, useCallback, useEffect, type CSSProperties } from 'react'
import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { EFFECTS, NODE_DEF_MAP, breakRuleEntries, gameCropIds, PIN_COLORS, visibleInputs, type PinDef } from '@core/nodes/defs'
import { registry } from '@core/ext/registry'
import { L } from '../i18n'
import { assetUrl, vanillaIconUrl } from '../api'
import { useItemInfo } from './VanillaPanel'
import { TagStrip } from './TagPreview'
import { useStore, type FlowNode } from '../store'

/** Returns a stable string of this node's connected handles, so nodes only re-render when their wires change. */
function useConnected(id: string): Set<string> {
  const key = useStore(
    useCallback(
      (s) =>
        s.edges
          .filter((e) => e.source === id || e.target === id)
          .map((e) => (e.target === id ? `i:${e.targetHandle}` : `o:${e.sourceHandle}`))
          .sort()
          .join('|'),
      [id]
    )
  )
  return new Set(key ? key.split('|') : [])
}

function Pin({ nodeId, pin, dir, on }: { nodeId: string; pin: PinDef; dir: 'in' | 'out'; on: boolean }) {
  const right = dir === 'out' || !!pin.right
  return (
    <div
      className={`nk-pin ${right ? 'out' : 'in'}${dir === 'in' && right ? ' in-right' : ''}${pin.optional ? ' opt' : ''}`}
      onMouseDownCapture={(e) => {
        // Alt+click a pin: remove its wires (like Unreal) instead of starting a new one
        if (!e.altKey || !(e.target as HTMLElement).classList.contains('react-flow__handle')) return
        e.preventDefault()
        e.stopPropagation()
        const s = useStore.getState()
        s.disconnect(
          s.edges
            .filter((x) => (dir === 'in' ? x.target === nodeId && x.targetHandle === pin.id : x.source === nodeId && x.sourceHandle === pin.id))
            .map((x) => x.id)
        )
      }}
    >
      <Handle
        type={dir === 'in' ? 'target' : 'source'}
        position={right ? Position.Right : Position.Left}
        id={pin.id}
        className={`pin${on ? ' on' : ''}${pin.multi ? ' multi' : ''}`}
        style={{ '--pin': PIN_COLORS[pin.type] } as CSSProperties}
        title={pin.type}
      />
      {L(pin.label)}
    </div>
  )
}

function Summary({ type, data, connected }: { type: string; data: Record<string, unknown>; connected: Set<string> }) {
  const asset = typeof data.asset === 'string' ? data.asset : ''
  switch (type) {
    case 'texture':
      return asset ? (
        <>
          <img className="pixel frame0" src={assetUrl(asset)} alt="" draggable={false} />
          {data.animated ? <span className="badge">▶ {String(data.frameTime ?? 2)}t</span> : null}
        </>
      ) : (
        <span className="muted">—</span>
      )
    case 'animation':
      return <span className="mono">{asset ? `${asset.split('/')[1]} · ${String(data.anim ?? '')}` : '—'}</span>
    case 'effect': {
      const e = EFFECTS.find((x) => x.value === data.effect)
      return (
        <span>
          {e ? L(e.label) : '?'} {romanLevel(Number(data.level ?? 1))} · {String(data.seconds ?? 10)}s
          {Number(data.chance ?? 1) < 1 ? ` · ${Math.round(Number(data.chance) * 100)}%` : ''}
        </span>
      )
    }
    case 'model':
    case 'geoModel':
      return <span className="mono">{asset ? asset.slice(asset.lastIndexOf('/') + 1) : '—'}</span>
    case 'soundFile': {
      const s = Number(data.seconds ?? 0)
      return (
        <span className="mono">
          {asset ? asset.slice(asset.lastIndexOf('/') + 1) : '—'}
          {s > 0 ? ` · ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : ''}
        </span>
      )
    }
    case 'itemRef':
      return <VanillaRef id={String(data.item ?? '')} />
    case 'tagRef':
      return (
        <span className="tag-summary">
          <span className="mono">#{String(data.tag ?? '')}</span>
          <TagStrip tagId={String(data.tag ?? '')} />
        </span>
      )
    case 'recipeShaped': {
      const grid = Array.isArray(data.grid) ? (data.grid as unknown[]) : []
      return (
        <div className="mini-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} className={connected.has(`i:s${i + 1}`) || (typeof grid[i] === 'string' && connected.has(`i:${grid[i] as string}`)) ? 'on' : ''} />
          ))}
        </div>
      )
    }
    case 'gameCrop': {
      const ids = gameCropIds(data)
      const opts = NODE_DEF_MAP.gameCrop.props.find((p) => p.key === 'crops')?.options ?? []
      const names = ids.map((id) => {
        const o = opts.find((x) => x.value === id)
        return o ? L(o.label).replace(/ \(Farmer's Delight\)$/, ' (FD)') : id
      })
      return <span title={names.join(', ')}>{names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ') || '—'}</span>
    }
    case 'regenBlock': {
      const input = NODE_DEF_MAP.regenBlock.props.find((p) => p.key === 'input')?.options?.find((o) => o.value === (data.input ?? 'break'))
      return (
        <span>
          {breakRuleEntries(data).length} ⬛ · {input ? L(input.label) : ''} · ♻ {String(data.regenSeconds ?? 60)}s
        </span>
      )
    }
    case 'breakRule': {
      const def = NODE_DEF_MAP.breakRule.props
      const tool = def.find((p) => p.key === 'tool')?.options?.find((o) => o.value === (data.tool ?? 'pickaxe'))
      const level = data.tool === 'shears' ? undefined : def.find((p) => p.key === 'level')?.options?.find((o) => o.value === (data.level ?? 'stone'))
      const n = breakRuleEntries(data).length + [...connected].filter((c) => c.startsWith('i:block')).length
      return (
        <span>
          {tool ? L(tool.label) : '?'}
          {level ? ` · ${L(level.label)}` : ''} · {n} ⬛
        </span>
      )
    }
    case 'armorSet':
      return <span className="mono">{String(data.baseId ?? '')}_*</span>
    default:
      if (typeof data.id === 'string')
        return (
          <span className="mono" title={String(data.name ?? '')}>
            {String(data.id)}
          </span>
        )
      return null
  }
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
function romanLevel(n: number) {
  return ROMAN[Math.min(10, Math.max(1, n)) - 1]
}

/** Vanilla item with icon and localized name when the item list for the active version is loaded. */
function VanillaRef({ id }: { id: string }) {
  const info = useItemInfo(id)
  if (!info) return <span className="mono">{id}</span>
  return (
    <>
      {info.item.icon && <img className="pixel frame0" src={vanillaIconUrl(info.mc, info.item.id, info.ns)} alt="" draggable={false} />}
      <span className="ellipsis">{info.item.en}</span>
    </>
  )
}

export const NodeView = memo(function NodeView({ id, type, data, selected }: NodeProps<FlowNode>) {
  const { t } = useTranslation() // also re-renders when the UI language changes
  const updateInternals = useUpdateNodeInternals()
  const def = NODE_DEF_MAP[type]
  const issue = useStore(useCallback((s) => s.issues[id], [id]))
  const connected = useConnected(id)
  const shown = def ? visibleInputs(def, (p) => connected.has(`i:${p}`), data) : null
  const shownKey = shown ? [...shown.left, ...shown.right].map((p) => p.id).join(',') : ''
  // pins appear/disappear as wires are added, so React Flow must re-measure the handles
  useEffect(() => updateInternals(id), [id, shownKey, updateInternals])
  if (!def || !shown) return <div className="nk error">?</div>
  const vis = shown
  const rightPins: { pin: PinDef; dir: 'in' | 'out' }[] = [
    ...vis.right.map((pin) => ({ pin, dir: 'in' as const })),
    ...def.outputs.map((pin) => ({ pin, dir: 'out' as const }))
  ]
  const rows = Math.max(vis.left.length, rightPins.length)
  const sub = <Summary type={type} data={data} connected={connected} />
  const title = typeof data.name === 'string' && data.name && def.registers ? `${L(def.title)} · ${data.name}` : L(def.title)
  return (
    <div className={`nk${selected ? ' sel' : ''}${data.disabled ? ' off' : issue ? ` ${issue}` : ''}`}>
      <div className="nk-head">
        <span className="dot" style={{ background: registry.categoryColor(def.category) }} />
        <span aria-hidden>{def.icon}</span>
        <span className="nk-title" title={title}>
          {title}
        </span>
        {data.disabled ? <span className="nk-off">{t('ws.disabledBadge')}</span> : null}
      </div>
      {sub && <div className="nk-sub">{sub}</div>}
      <div className="nk-pins">
        {Array.from({ length: rows }, (_, i) => (
          <div className="nk-row" key={i}>
            {vis.left[i] ? <Pin nodeId={id} pin={vis.left[i]} dir="in" on={connected.has(`i:${vis.left[i].id}`)} /> : <span />}
            {rightPins[i] && (
              <Pin
                nodeId={id}
                pin={rightPins[i].pin}
                dir={rightPins[i].dir}
                on={connected.has(`${rightPins[i].dir === 'in' ? 'i' : 'o'}:${rightPins[i].pin.id}`)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

const CommentView = memo(function CommentView({ data, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        minHeight={80}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{ width: 9, height: 9, borderRadius: 3 }}
      />
      <div className={`nk-comment${selected ? ' sel' : ''}`} style={{ '--c': String(data.color ?? '#6b7280') } as CSSProperties}>
        {String(data.text ?? '')}
      </div>
    </>
  )
})

const RerouteView = memo(function RerouteView() {
  return (
    <div className="nk-reroute">
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
})

/**
 * A node whose type does not exist (removed from the app, or from an extension that is not installed): a
 * gray card. Its data stays in the project; React Flow uses the `default` type for every unknown type.
 */
const MissingView = memo(function MissingView({ type, selected }: NodeProps<FlowNode>) {
  return (
    <div className={`nk missing${selected ? ' sel' : ''}`}>
      <div className="nk-head">
        <span aria-hidden>⚠</span>
        <span className="nk-title mono">{type}</span>
      </div>
      <div className="nk-sub">
        {L({
          en: 'This node type is not available (removed, or its extension is not installed). Its data is kept.',
          th: 'ไม่มีโหนดชนิดนี้แล้ว (ถูกเอาออก หรือยังไม่ได้ติดตั้งส่วนเสริมของมัน) ข้อมูลยังเก็บไว้'
        })}
      </div>
    </div>
  )
})

/** React Flow node components for every registered node type (rebuilt when an extension adds or removes nodes). */
export function buildNodeTypes() {
  return {
    ...Object.fromEntries(Object.keys(NODE_DEF_MAP).map((t) => [t, t === 'comment' ? CommentView : t === 'reroute' ? RerouteView : NodeView])),
    default: MissingView
  }
}
