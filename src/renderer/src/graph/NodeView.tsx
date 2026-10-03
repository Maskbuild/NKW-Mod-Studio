import { memo, useCallback, useEffect, type CSSProperties } from 'react'
import { JAVA_KEYWORDS } from '@core/scriptApi'
import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { EFFECTS, NODE_DEF_MAP, breakRuleEntries, gameCropIds, PIN_COLORS, visibleInputs, type Category, type PinDef } from '@core/nodes/defs'
import { L } from '../i18n'
import { assetUrl, vanillaIconUrl } from '../api'
import { useItemInfo } from './VanillaPanel'
import { TagStrip } from './TagPreview'
import { useStore, type FlowNode } from '../store'

export const CATEGORY_COLOR: Record<Category, string> = {
  asset: '#f59e0b',
  item: '#3b82f6',
  block: '#8b5cf6',
  farm: '#65a30d',
  armor: '#f97316',
  sound: '#10b981',
  recipe: '#e11d48',
  fd: '#84cc16',
  script: '#a855f7',
  addon: '#0ea5e9',
  mob: '#b91c1c',
  effect: '#ec4899',
  util: '#71717a'
}

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
    case 'script':
      return <CodePreview code={String(data.code ?? '')} targets={Array.isArray(data.targets) ? (data.targets as string[]) : []} />
    case 'gameCrop': {
      const ids = gameCropIds(data)
      const opts = NODE_DEF_MAP.gameCrop.props.find((p) => p.key === 'crops')?.options ?? []
      const names = ids.map((id) => {
        const o = opts.find((x) => x.value === id)
        return o ? L(o.label).replace(/ \(Farmer's Delight\)$/, ' (FD)') : id
      })
      return <span title={names.join(', ')}>{names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ') || '—'}</span>
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

const KEYWORDS = new Set(JAVA_KEYWORDS)

/** One line of Java with simple VS Code-like colours (keywords, types, strings, comments, annotations). */
function JavaLine({ text }: { text: string }) {
  const parts: { t: string; c?: string }[] = []
  const re = /(\/\/.*$|\/\*.*?(?:\*\/|$)|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|@\w+|\b\d[\w.]*\b|\b[A-Za-z_$][\w$]*\b)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index) })
    const tok = m[0]
    const c =
      tok.startsWith('//') || tok.startsWith('/*')
        ? 'cm'
        : tok[0] === '"' || tok[0] === "'"
          ? 'st'
          : tok[0] === '@'
            ? 'an'
            : /^\d/.test(tok)
              ? 'nu'
              : KEYWORDS.has(tok)
                ? 'kw'
                : /^[A-Z]/.test(tok)
                  ? 'ty'
                  : undefined
    parts.push({ t: tok, c })
    last = m.index + tok.length
  }
  if (last < text.length) parts.push({ t: text.slice(last) })
  return (
    <div className="code-line">
      {parts.map((p, i) =>
        p.c ? (
          <span key={i} className={`ck-${p.c}`}>
            {p.t}
          </span>
        ) : (
          p.t
        )
      )}
      {'\u200b'}
    </div>
  )
}

/** Canvas preview of a Script node: file name, targets and the start of the class (package/imports skipped). */
function CodePreview({ code, targets }: { code: string; targets: string[] }) {
  const { t } = useTranslation()
  const all = code.replace(/\r\n?/g, '\n').split('\n')
  const body = all.filter((l) => !/^\s*(package|import)\s[^;]*;\s*$/.test(l))
  while (body.length && !body[0].trim()) body.shift()
  const shown = body.slice(0, 12)
  const indent = Math.min(...shown.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].replace(/\t/g, '    ').length), 99)
  const cls = /(?:^|[\s;}])public\s+(?:(?:final|abstract|static)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(code)?.[1]
  return (
    <div className="code-preview">
      <div className="code-head">
        <span className="mono">{cls ? `${cls}.java` : '—'}</span>
        <span className="code-targets">{targets.length ? targets.map((x) => x.replace('-', ' ')).join(', ') : t('script.allTargets')}</span>
      </div>
      <div className="code-body">
        {shown.map((l, i) => (
          <JavaLine key={i} text={l.replace(/\t/g, '    ').slice(indent === 99 ? 0 : indent)} />
        ))}
        {body.length > shown.length && <div className="code-more">{t('ws.moreLines', { count: body.length - shown.length })}</div>}
      </div>
    </div>
  )
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
  const def = NODE_DEF_MAP[type]
  const issue = useStore(useCallback((s) => s.issues[id], [id]))
  const connected = useConnected(id)
  const updateInternals = useUpdateNodeInternals()
  const shown = def ? visibleInputs(def, (p) => connected.has(`i:${p}`)) : null
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
        <span className="dot" style={{ background: CATEGORY_COLOR[def.category] }} />
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

export const CommentView = memo(function CommentView({ data, selected }: NodeProps<FlowNode>) {
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

export const RerouteView = memo(function RerouteView() {
  return (
    <div className="nk-reroute">
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
})

export const NODE_TYPES = Object.fromEntries(
  Object.keys(NODE_DEF_MAP).map((t) => [t, t === 'comment' ? CommentView : t === 'reroute' ? RerouteView : NodeView])
)
