import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { CATEGORY_LABEL, NODE_DEF_MAP, PIN_COLORS, gameCropIds, type NodeDef, type PropDef } from '@core/nodes/defs'
import { ASSET_RE, FOLDER_RE, ID_RE, LICENSES, LINK_RE, MetaSchema, NSID_RE, toId, type Credit } from '@core/project'
import { L } from '../i18n'
import { api, assetUrl, vanillaIconUrl, type AssetKind, type ImportedAsset } from '../api'
import { hasFiles, importDropped } from '../drop'
import { prettyId, useActiveMc, useItemInfo, useItemSources, useVanilla } from './VanillaPanel'
import { newId, useStore, edgeStyle, inputSource, type FlowNode } from '../store'
import { TargetPicker } from '../components/TargetPicker'
import { IAlert, IUpload, Logo } from '../components/Icons'

import { CraftGrid } from './CraftGrid'
import { useIde } from '../ide/ideStore'
import { ArmorFitField } from './ArmorFit'
import { TabOrder } from './TabOrder'
import { HarvestUiPreview } from './HarvestUiPreview'
import { BlockListField } from './BlockList'
import { TagGrid } from './TagPreview'

const ModelPreview = lazy(() => import('./ModelPreview'))

const VANILLA_ITEMS = [
  'diamond',
  'emerald',
  'iron_ingot',
  'gold_ingot',
  'copper_ingot',
  'netherite_ingot',
  'coal',
  'redstone',
  'lapis_lazuli',
  'quartz',
  'amethyst_shard',
  'stick',
  'string',
  'leather',
  'feather',
  'bone',
  'gunpowder',
  'blaze_rod',
  'ender_pearl',
  'slime_ball',
  'glowstone_dust',
  'paper',
  'book',
  'oak_planks',
  'oak_log',
  'cobblestone',
  'stone',
  'glass',
  'sand',
  'gravel',
  'dirt',
  'obsidian',
  'iron_block',
  'gold_block',
  'diamond_block',
  'wheat',
  'carrot',
  'potato',
  'beetroot',
  'apple',
  'bread',
  'egg',
  'milk_bucket',
  'sugar',
  'cocoa_beans',
  'honey_bottle',
  'sweet_berries',
  'beef',
  'porkchop',
  'chicken',
  'mutton',
  'cod',
  'salmon',
  'kelp',
  'brown_mushroom',
  'red_mushroom',
  'pumpkin',
  'melon_slice',
  'bowl',
  'bucket',
  'water_bucket',
  'glass_bottle',
  'shears',
  'flint',
  'clay_ball',
  'brick',
  'nether_star',
  'dragon_breath',
  'netherite_upgrade_smithing_template',
  'iron_sword',
  'diamond_sword',
  'iron_pickaxe',
  'diamond_pickaxe',
  'music_disc_13'
].map((i) => `minecraft:${i}`)
const COMMON_TAGS = [
  'minecraft:planks',
  'minecraft:logs',
  'minecraft:wool',
  'minecraft:stone_crafting_materials',
  'minecraft:coals',
  'minecraft:fishes',
  'c:ingots/iron',
  'c:gems/diamond',
  'c:crops',
  'c:vegetables',
  'forge:ingots/iron'
]

function NumberField({ p, value, onChange }: { p: PropDef; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const int = p.kind === 'int'
  const commit = (s: string) => {
    let v = Number(s)
    if (!Number.isFinite(v)) return setText(null)
    if (int) v = Math.round(v)
    if (p.min !== undefined) v = Math.max(p.min, v)
    if (p.max !== undefined) v = Math.min(p.max, v)
    onChange(v)
    setText(null)
  }
  const slider = p.min !== undefined && p.max !== undefined && p.max - p.min <= 100
  return (
    <div className="num-row">
      {slider && (
        <input type="range" min={p.min} max={p.max} step={p.step ?? (int ? 1 : 0.1)} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      )}
      <input
        className="input mono"
        style={slider ? undefined : { width: '100%' }}
        inputMode="decimal"
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
    </div>
  )
}

function assetKindOf(p: PropDef): AssetKind {
  return p.assetKind ?? 'texture'
}

function AssetField({ node, p }: { node: FlowNode; p: PropDef }) {
  const { t } = useTranslation()
  const kind = assetKindOf(p)
  const assets = useStore((s) => s.assets)
  const [over, setOver] = useState(false)
  const value = String(node.data[p.key] ?? '')
  const options = assets.filter((a) => a.kind === kind)

  /** Assigns imported assets to this node (shared by the Import button and drag & drop). */
  const apply = (res: ImportedAsset[]) => {
    if (!res.length) return
    const s = useStore.getState()
    const first = res[0]
    s.updateData(node.id, {
      [p.key]: first.asset,
      ...(first.textureSlots ? { textureSlots: first.textureSlots } : {}),
      ...(first.animations?.length ? { anim: first.animations[0] } : {})
    })
    for (const a of res) if (a.warning) s.toast(`${a.name}: ${a.warning}`)
    // A .bbmodel brings its own textures: add Texture nodes and wire them to the model.
    // GeckoLib models take one texture, Java models up to four.
    if ((first.kind === 'model' || first.kind === 'geo') && first.textures?.length) {
      const nodes = [...useStore.getState().nodes]
      let edges = [...useStore.getState().edges]
      first.textures.slice(0, first.kind === 'geo' ? 1 : 4).forEach((tex, i) => {
        if (!tex) return
        const handle = first.kind === 'geo' ? 'texture' : `tex${i}`
        const id = newId()
        nodes.push({ id, type: 'texture', position: { x: node.position.x - 280, y: node.position.y + i * 110 }, data: { asset: tex } })
        edges = edges.filter((e) => !(e.target === node.id && e.targetHandle === handle))
        edges.push({ id: newId('e'), source: id, sourceHandle: 'out', target: node.id, targetHandle: handle, style: edgeStyle('texture', 'out') })
      })
      s.setGraph(nodes, edges)
    }
  }

  const doImport = async () => {
    try {
      apply(await api.importAssets(kind))
      await useStore.getState().refreshAssets()
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
    }
  }

  return (
    <div
      className={`drop-field${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        apply(await importDropped(Array.from(e.dataTransfer.files).slice(0, 1), kind))
      }}
    >
      <div className="row">
        <select
          className="input grow"
          value={value}
          onChange={(e) => {
            const entry = assets.find((a) => a.asset === e.target.value)
            useStore.getState().updateData(node.id, { [p.key]: e.target.value, ...(entry?.seconds ? { seconds: entry.seconds } : {}) })
          }}
        >
          <option value="">{t('ws.none')}</option>
          {options.map((a) => (
            <option key={a.asset} value={a.asset}>
              {a.asset.split('/')[1]}
            </option>
          ))}
          {value && !options.some((o) => o.asset === value) && <option value={value}>{value}</option>}
        </select>
        <button className="btn" onClick={doImport} title={t('ws.import')}>
          <IUpload size={14} />
        </button>
      </div>
      <span className="hint">{t('ws.dropHere')}</span>
    </div>
  )
}

/** Picks which animation of the node's .animation.json file to loop. */
function AnimNameField({ node, p }: { node: FlowNode; p: PropDef }) {
  const asset = typeof node.data.asset === 'string' ? node.data.asset : ''
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    if (!asset) return setNames([])
    let alive = true
    void api
      .animationNames(asset)
      .then((n) => alive && setNames(n))
      .catch(() => alive && setNames([]))
    return () => {
      alive = false
    }
  }, [asset])
  const value = String(node.data[p.key] ?? '')
  return (
    <div className="field">
      <label>{L(p.label)}</label>
      <select
        className={`input mono${value ? '' : ' invalid'}`}
        value={value}
        onChange={(e) => useStore.getState().updateData(node.id, { [p.key]: e.target.value })}
      >
        <option value="">—</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        {value && !names.includes(value) && <option value={value}>{value}</option>}
      </select>
    </div>
  )
}

/** Crops found in the downloaded game data and in the mods linked to the project (Harvest a game crop). */
function MoreCrops({ known, list, toggle }: { known: string[]; list: string[]; toggle: (v: string) => void }) {
  const sources = useItemSources(useActiveMc())
  const crops = sources.flatMap(({ data, source }) =>
    (data.crops ?? [])
      .map((c) => `${data.ns}:${c}`)
      .filter((id) => !known.includes(id))
      .map((id) => ({ id, from: data.title ?? (source === 'minecraft' ? 'Minecraft' : "Farmer's Delight") }))
  )
  return (
    <>
      {crops.map((c) => (
        <label key={c.id} className={`multi-opt${list.includes(c.id) ? ' on' : ''}`} title={c.id}>
          <input type="checkbox" checked={list.includes(c.id)} onChange={() => toggle(c.id)} />
          {prettyId(c.id)} <span className="faint">({c.from})</span>
        </label>
      ))}
    </>
  )
}

/** Item id / tag field backed by the full vanilla list of the active Minecraft version. */
function NsidField({ node, p }: { node: FlowNode; p: PropDef }) {
  const { i18n } = useTranslation()
  const mc = useActiveMc()
  const data = useVanilla(mc)
  const sources = useItemSources(mc)
  const value = String(node.data[p.key] ?? '')
  const isTag = node.type === 'tagRef'
  // the game's list (or a short built-in one before it is downloaded), Farmer's Delight and linked mods
  const others = sources.filter((x) => x.source !== 'minecraft')
  const list = isTag
    ? [...(data ? data.tags.map((t) => t.id) : COMMON_TAGS), ...others.flatMap((x) => x.data.tags.map((t) => t.id))]
    : [...(data ? data.items.map((i) => `minecraft:${i.id}`) : VANILLA_ITEMS), ...others.flatMap((x) => x.data.items.map((i) => `${x.data.ns}:${i.id}`))]
  const match = useItemInfo(isTag ? '' : value)
  return (
    <div className="field">
      <label>{L(p.label)}</label>
      <input
        className={`input mono${NSID_RE.test(value.replace(/^#/, '')) ? '' : ' invalid'}`}
        list={`dl-${p.key}-${node.type}`}
        value={value}
        maxLength={190}
        onChange={(e) => useStore.getState().updateData(node.id, { [p.key]: e.target.value.toLowerCase().trim() })}
      />
      <datalist id={`dl-${p.key}-${node.type}`}>
        {list.map((i) => (
          <option key={i} value={i} />
        ))}
      </datalist>
      {match && (
        <div className="row item-preview">
          {match.item.icon && <img className="pixel frame0" src={vanillaIconUrl(match.mc, match.item.id, match.ns)} alt="" />}
          <span>{match.item.en}</span>
        </div>
      )}
      {isTag && NSID_RE.test(value.replace(/^#/, '')) && <TagGrid tagId={value} />}
      {!data && (
        <span className="hint">
          {i18n.language === 'th' ? 'โหลดรายการไอเทมทั้งหมดได้ที่แท็บ "ไอเทมเกม"' : 'Load the full item list in the "Game items" tab'}
        </span>
      )}
    </div>
  )
}

function Preview({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const asset = typeof node.data.asset === 'string' ? node.data.asset : ''
  const texKey = useStoreWithEqualityFn(
    useStore,
    useCallback(
      (s) =>
        [0, 1, 2, 3].map((i) => {
          const e = s.edges.find((x) => x.target === node.id && x.targetHandle === `tex${i}`)
          const src = e && s.nodes.find((n) => n.id === e.source)
          return src && typeof src.data.asset === 'string' ? src.data.asset : null
        }),
      [node.id]
    ),
    shallow
  )
  if (node.type === 'soundEvent') return <SoundEventPreview node={node} />
  if (node.type === 'harvestUi') return <HarvestUiPreview data={node.data} />
  if (!asset) return null
  if (node.type === 'texture')
    return (
      <div className="preview-box">
        <img className="pixel" src={assetUrl(asset)} alt="" />
      </div>
    )
  if (node.type === 'soundFile') return <audio controls src={assetUrl(asset)} style={{ width: '100%', marginBottom: 10 }} />
  if (node.type === 'model')
    return (
      <>
        <div className="preview-box">
          <Suspense fallback={<div className="preview3d" />}>
            <ModelPreview asset={asset} textures={texKey} />
          </Suspense>
        </div>
        {asset.endsWith('.json') && (
          <button className="btn small edit-model" onClick={() => useIde.getState().openModel(asset, texKey)}>
            🧊 {t('model.edit')}
          </button>
        )}
      </>
    )
  return null
}

/** Plays the first sound of a Sound Event with its volume and pitch applied. */
function SoundEventPreview({ node }: { node: FlowNode }) {
  const { i18n } = useTranslation()
  const asset = useStore(
    useCallback(
      (s) => {
        const e = s.edges.find((x) => x.target === node.id && x.targetHandle === 'sound1')
        const src = e && s.nodes.find((n) => n.id === e.source)
        return src && typeof src.data.asset === 'string' ? src.data.asset : ''
      },
      [node.id]
    )
  )
  const ref = useRef<HTMLAudioElement>(null)
  const volume = Number(node.data.volume ?? 1)
  const pitch = Number(node.data.pitch ?? 1)
  useEffect(() => {
    const a = ref.current
    if (!a) return
    a.volume = Math.min(1, Math.max(0, volume))
    a.preservesPitch = false
    a.playbackRate = Math.min(2, Math.max(0.5, pitch))
  }, [volume, pitch, asset])
  if (!asset) return null
  return (
    <>
      <audio ref={ref} controls src={assetUrl(asset)} style={{ width: '100%' }} />
      <div className="hint" style={{ margin: '4px 0 10px' }}>
        {i18n.language === 'th'
          ? 'ตัวอย่างเล่นตามความดังและระดับเสียงที่ตั้ง · ในเกม ความดังเกิน 1.0 จะเพิ่มระยะที่ได้ยิน ไม่ได้ดังขึ้น (ถ้าอยากให้ดังขึ้นจริง ให้ปรับตอนแปลงไฟล์เสียง)'
          : 'Preview uses the volume and pitch above · in game, volume above 1.0 increases hearing distance, not loudness (boost loudness in the audio converter)'}
      </div>
    </>
  )
}

/** Icon / texture pins of a node, editable right here: pick, drop a PNG, or clear. */
function TextureSlots({ node, def }: { node: FlowNode; def: NodeDef }) {
  const { t } = useTranslation()
  const pins = def.inputs.filter((p) => p.type === 'texture')
  const assets = useStore((s) => s.assets)
  const textures = assets.filter((a) => a.kind === 'texture')
  const [over, setOver] = useState<string | null>(null)
  const current = useStoreWithEqualityFn(
    useStore,
    useCallback(
      (s) =>
        pins.map((p) => {
          const src = inputSource(s.nodes, s.edges, node.id, p.id)
          return src?.type === 'texture' && typeof src.data.asset === 'string' ? src.data.asset : ''
        }),
      // pins only depend on the node type
      [node.id, def.type]
    ),
    shallow
  )
  if (!pins.length) return null

  const assign = (pin: string, asset: string) => {
    const s = useStore.getState()
    s.checkpoint()
    const edge = s.edges.find((x) => x.target === node.id && x.targetHandle === pin)
    const src = edge && s.nodes.find((n) => n.id === edge.source)
    let edges = s.edges
    let nodes = s.nodes
    if (!asset) {
      edges = edges.filter((x) => x !== edge)
    } else if (src?.type === 'texture' && s.edges.filter((x) => x.source === src.id).length === 1) {
      // this texture node only feeds this pin: just swap its file
      nodes = nodes.map((n) => (n.id === src.id ? { ...n, data: { ...n.data, asset } } : n))
    } else {
      const id = newId()
      const i = pins.findIndex((p) => p.id === pin)
      nodes = [...nodes, { id, type: 'texture', position: { x: node.position.x - 260, y: node.position.y + i * 100 }, data: { asset } }]
      edges = [
        ...edges.filter((x) => x !== edge),
        { id: newId('e'), source: id, sourceHandle: 'out', target: node.id, targetHandle: pin, style: edgeStyle('texture', 'out') }
      ]
    }
    s.setGraph(nodes, edges)
  }

  return (
    <>
      <div className="insp-sec">{t('ws.textures')}</div>
      {pins.map((p, i) => (
        <div
          key={p.id}
          className={`tex-slot${over === p.id ? ' over' : ''}`}
          onDragOver={(e) => {
            if (!hasFiles(e) && !e.dataTransfer.types.includes('application/nkw-asset')) return
            e.preventDefault()
            setOver(p.id)
          }}
          onDragLeave={() => setOver(null)}
          onDrop={async (e) => {
            e.preventDefault()
            setOver(null)
            const internal = e.dataTransfer.getData('application/nkw-asset')
            if (internal.startsWith('texture|')) return assign(p.id, internal.split('|')[1])
            if (hasFiles(e)) {
              const res = await importDropped(Array.from(e.dataTransfer.files).slice(0, 1), 'texture')
              if (res[0]) assign(p.id, res[0].asset)
            }
          }}
        >
          <div className="tex-thumb">{current[i] ? <img className="pixel frame0" src={assetUrl(current[i])} alt="" /> : <span className="faint">+</span>}</div>
          <div className="grow">
            <div className="faint">{L(p.label)}</div>
            <select className="input" value={current[i]} onChange={(e) => assign(p.id, e.target.value)}>
              <option value="">{t('ws.none')}</option>
              {textures.map((a) => (
                <option key={a.asset} value={a.asset}>
                  {a.asset.replace(/^textures\//, '')}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </>
  )
}

function PropField({ node, def, p }: { node: FlowNode; def: NodeDef; p: PropDef }) {
  const { t } = useTranslation()
  const value = node.data[p.key]
  const set = (v: unknown) => {
    const patch: Record<string, unknown> = { [p.key]: v }
    // keep the registry id in sync with the display name until the user edits it
    if (p.key === 'name' && typeof v === 'string') {
      const idKey = def.props.some((x) => x.key === 'id') ? 'id' : def.props.some((x) => x.key === 'baseId') ? 'baseId' : null
      if (idKey && (node.data[idKey] === toId(String(node.data.name ?? '')) || node.data[idKey] === def.props.find((x) => x.key === idKey)?.default))
        patch[idKey] = toId(v)
    }
    useStore.getState().updateData(node.id, patch)
  }
  switch (p.kind) {
    case 'bool': {
      // settings never saved on older nodes show their default
      const on = value === undefined ? !!p.default : !!value
      return (
        <div className="bool-row">
          <span>{L(p.label)}</span>
          <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => set(!on)} />
          {p.hint && (
            <span className="hint" style={{ flexBasis: '100%' }}>
              {L(p.hint)}
            </span>
          )}
        </div>
      )
    }
    case 'int':
    case 'float':
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <NumberField p={p} value={typeof value === 'number' ? value : Number(p.default)} onChange={set} />
          {p.hint && <span className="hint">{L(p.hint)}</span>}
        </div>
      )
    case 'select':
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <select className="input" value={String(value ?? p.default)} onChange={(e) => set(e.target.value)}>
            {p.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {L(o.label)}
              </option>
            ))}
          </select>
          {p.hint && <span className="hint">{L(p.hint)}</span>}
        </div>
      )
    case 'multi': {
      const list = Array.isArray(value)
        ? (value as string[])
        : def.type === 'gameCrop'
          ? gameCropIds(node.data).filter((v) => p.options?.some((o) => o.value === v))
          : (p.default as string[])
      const toggle = (v: string) => {
        const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
        const patch: Record<string, unknown> = { [p.key]: next }
        // older single-crop nodes: keep a typed id when switching to the list
        if (def.type === 'gameCrop' && node.data.crop === 'custom' && typeof node.data.block === 'string' && node.data.others === undefined)
          patch.others = node.data.block
        useStore.getState().updateData(node.id, patch)
      }
      return (
        <div className="field">
          <label>
            {L(p.label)} <span className="faint">({list.length})</span>
          </label>
          <div className="multi-pick">
            {p.options?.map((o) => (
              <label key={o.value} className={`multi-opt${list.includes(o.value) ? ' on' : ''}`}>
                <input type="checkbox" checked={list.includes(o.value)} onChange={() => toggle(o.value)} />
                {L(o.label)}
              </label>
            ))}
            {def.type === 'gameCrop' && <MoreCrops known={p.options?.map((o) => o.value) ?? []} list={list} toggle={toggle} />}
          </div>
          {p.hint && <span className="hint">{L(p.hint)}</span>}
        </div>
      )
    }
    case 'asset':
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <AssetField node={node} p={p} />
        </div>
      )
    case 'textarea':
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <textarea className="input" value={String(value ?? '')} maxLength={2000} onChange={(e) => set(e.target.value)} />
        </div>
      )
    case 'color':
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <input type="color" className="input" style={{ padding: 2 }} value={String(value ?? '#6b7280')} onChange={(e) => set(e.target.value)} />
        </div>
      )
    case 'id': {
      const v = String(value ?? '')
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <div className="row">
            <input
              className={`input mono grow${ID_RE.test(v) ? '' : ' invalid'}`}
              value={v}
              maxLength={63}
              onChange={(e) => set(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            />
            {typeof node.data.name === 'string' && (
              <button className="btn" title={t('ws.idFromName')} onClick={() => set(toId(String(node.data.name)))}>
                ↻
              </button>
            )}
          </div>
          {p.hint && <span className="hint">{L(p.hint)}</span>}
        </div>
      )
    }
    case 'nsid':
      return <NsidField node={node} p={p} />
    case 'animName':
      return <AnimNameField node={node} p={p} />
    case 'blockList':
      return <BlockListField node={node} p={p} />
    case 'craftGrid':
      return <CraftGrid node={node} />
    case 'armorFit':
      return <ArmorFitField node={node} />
    case 'tabOrder':
      return <TabOrder node={node} />
    default:
      return (
        <div className="field">
          <label>{L(p.label)}</label>
          <input className="input" value={String(value ?? '')} maxLength={200} onChange={(e) => set(e.target.value)} />
        </div>
      )
  }
}

/** Mod logo: upload / drop a PNG or pick a project texture. Shown in Mod Menu and the mod list. */
function ModLogo() {
  const { t } = useTranslation()
  const meta = useStore((s) => s.meta)!
  const textures = useStore((s) => s.assets).filter((a) => a.kind === 'texture')
  const [over, setOver] = useState(false)
  const setIcon = (icon: string) => useStore.getState().setMeta({ ...meta, icon: icon || undefined })
  const upload = async () => {
    try {
      const res = await api.importAssets('texture')
      if (res[0]) setIcon(res[0].asset)
      await useStore.getState().refreshAssets()
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
    }
  }
  return (
    <div
      className={`field tex-slot${over ? ' over' : ''}`}
      style={{ flexDirection: 'row' }}
      onDragOver={(e) => {
        if (!hasFiles(e) && !e.dataTransfer.types.includes('application/nkw-asset')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setOver(false)
        const internal = e.dataTransfer.getData('application/nkw-asset')
        if (internal.startsWith('texture|')) return setIcon(internal.split('|')[1])
        if (hasFiles(e)) {
          const res = await importDropped(Array.from(e.dataTransfer.files).slice(0, 1), 'texture')
          if (res[0]) setIcon(res[0].asset)
        }
      }}
    >
      <div className="tex-thumb logo-thumb">{meta.icon ? <img className="pixel frame0" src={assetUrl(meta.icon)} alt="" /> : <Logo size={40} />}</div>
      <div className="grow">
        <label className="faint">{t('ws.modLogo')}</label>
        <div className="row">
          <select className="input grow" value={meta.icon ?? ''} onChange={(e) => setIcon(e.target.value)}>
            <option value="">{t('ws.defaultLogo')}</option>
            {textures.map((a) => (
              <option key={a.asset} value={a.asset}>
                {a.asset.replace(/^textures\//, '')}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void upload()} title={t('ws.import')}>
            <IUpload size={14} />
          </button>
        </div>
        <span className="hint">{t('ws.modLogoHint')}</span>
      </div>
    </div>
  )
}

/** The /give command for nodes that register an item (items outside Creative Tabs are obtained this way). */
function GiveCommand({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const modId = useStore((s) => s.meta?.modId ?? '')
  const types = ['item', 'food', 'tool', 'musicDisc', 'armorPiece', 'block', 'block3d']
  if (!types.includes(node.type ?? '') || typeof node.data.id !== 'string' || node.data.hasItem === false) return null
  const cmd = `/give @s ${modId}:${node.data.id}`
  return (
    <div className="field">
      <label>{t('ws.giveCmd')}</label>
      <input className="input mono" readOnly value={cmd} onFocus={(e) => e.currentTarget.select()} />
    </div>
  )
}

function ProjectSettings() {
  const { t } = useTranslation()
  const meta = useStore((s) => s.meta)!
  const targets = useStore((s) => s.targets)
  const set = (patch: Partial<typeof meta>) => useStore.getState().setMeta({ ...meta, ...patch })
  const bad = (k: keyof typeof meta) => !MetaSchema.shape[k].safeParse(meta[k]).success
  return (
    <>
      <div className="insp-head">
        <span className="li-icon">⚙</span>
        <b className="grow">{meta.name}</b>
      </div>
      <div className="insp-desc">{t('ws.nothingSelected')}</div>
      <ModLogo />
      <div className="field">
        <label>{t('wizard.name')}</label>
        <input className={`input${bad('name') ? ' invalid' : ''}`} value={meta.name} maxLength={64} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>{t('wizard.modId')}</label>
        <input
          className={`input mono${bad('modId') ? ' invalid' : ''}`}
          value={meta.modId}
          maxLength={63}
          onChange={(e) => set({ modId: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
        />
        <span className="hint">{t('wizard.modIdHint')}</span>
      </div>
      <div className="row">
        <div className="field grow">
          <label>{t('wizard.authors')}</label>
          <input className="input" value={meta.authors} maxLength={200} onChange={(e) => set({ authors: e.target.value })} />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>{t('wizard.version')}</label>
          <input
            className={`input mono${bad('version') ? ' invalid' : ''}`}
            value={meta.version}
            maxLength={32}
            onChange={(e) => set({ version: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>{t('wizard.description')}</label>
        <textarea className="input" value={meta.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="field">
        <label>{t('ws.looseItems')}</label>
        <select className="input" value={meta.looseItems ?? 'hidden'} onChange={(e) => set({ looseItems: e.target.value as 'hidden' | 'main' })}>
          <option value="hidden">{t('ws.looseHidden')}</option>
          <option value="main">{t('ws.looseMain')}</option>
        </select>
      </div>
      <div className="field">
        <label>{t('ws.homepage')}</label>
        <input
          className={`input${meta.homepage?.trim() && !LINK_RE.test(meta.homepage.trim()) ? ' invalid' : ''}`}
          placeholder="https://…"
          value={meta.homepage ?? ''}
          maxLength={300}
          onChange={(e) => set({ homepage: e.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label>{t('ws.issues')}</label>
        <input
          className={`input${meta.issues?.trim() && !LINK_RE.test(meta.issues.trim()) ? ' invalid' : ''}`}
          placeholder="https://…/issues"
          value={meta.issues ?? ''}
          maxLength={300}
          onChange={(e) => set({ issues: e.target.value || undefined })}
        />
        <span className="hint">{t('ws.linksHint')}</span>
      </div>
      <LicenseField />
      <CreditsField />
      <div className="insp-sec">{t('wizard.targets')}</div>
      <TargetPicker value={targets} onChange={(v) => v.length && useStore.getState().setTargets(v)} />
    </>
  )
}

/** The mod's license: a common one from the list or a custom name, plus optional full text for the jar. */
function LicenseField() {
  const { t } = useTranslation()
  const meta = useStore((s) => s.meta)!
  const set = (patch: Partial<typeof meta>) => useStore.getState().setMeta({ ...meta, ...patch })
  const value = meta.license?.trim() || 'All-Rights-Reserved'
  const known = (LICENSES as readonly string[]).includes(value)
  const [custom, setCustom] = useState(!known)
  const [showText, setShowText] = useState(!!meta.licenseText)
  return (
    <>
      <div className="insp-sec">{t('license.title')}</div>
      <div className="field">
        <select
          className="input"
          value={custom ? '__custom' : value}
          onChange={(e) => {
            if (e.target.value === '__custom') {
              setCustom(true)
              set({ license: '' })
            } else {
              setCustom(false)
              set({ license: e.target.value === 'All-Rights-Reserved' ? undefined : e.target.value })
            }
          }}
        >
          {LICENSES.map((l) => (
            <option key={l} value={l}>
              {t(`license.names.${l.replaceAll('.', '_')}`, { defaultValue: l })}
            </option>
          ))}
          <option value="__custom">{t('license.custom')}</option>
        </select>
        {custom && (
          <input
            className="input"
            placeholder={t('license.customName')}
            value={meta.license ?? ''}
            maxLength={64}
            onChange={(e) => set({ license: e.target.value })}
          />
        )}
        <span className="hint">{t('license.hint')}</span>
      </div>
      {showText ? (
        <div className="field">
          <label>{t('license.text')}</label>
          <textarea
            className="input mono license-text"
            value={meta.licenseText ?? ''}
            maxLength={50000}
            placeholder={t('license.textHint')}
            onChange={(e) => set({ licenseText: e.target.value || undefined })}
          />
        </div>
      ) : (
        <button className="btn ghost small" onClick={() => setShowText(true)}>
          + {t('license.addText')}
        </button>
      )}
    </>
  )
}

/** People who made the mod's assets (or anything else), with an optional web link and the files they made. */
function CreditsField() {
  const { t } = useTranslation()
  const meta = useStore((s) => s.meta)!
  const assets = useStore((s) => s.assets)
  const allFiles = assets.filter((a) => a.kind !== 'folder' && ASSET_RE.test(a.asset)).map((a) => a.asset)
  // every folder: the kind roots, folders from the tree, and the folders the files are in
  const allFolders = [
    ...new Set([
      ...assets.filter((a) => a.kind === 'folder').map((a) => a.asset),
      ...allFiles.flatMap((a) =>
        a
          .split('/')
          .slice(0, -1)
          .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
      )
    ])
  ]
    .filter((d) => FOLDER_RE.test(d))
    .sort()
  const credits = meta.credits ?? []
  const save = (list: Credit[]) => useStore.getState().setMeta({ ...meta, credits: list.length ? list : undefined })
  const patch = (i: number, p: Partial<Credit>) => save(credits.map((c, k) => (k === i ? { ...c, ...p } : c)))
  return (
    <>
      <div className="insp-sec">{t('credits.title')}</div>
      <div className="field">
        <span className="hint">{t('credits.hint')}</span>
      </div>
      {credits.map((c, i) => {
        const badLink = c.link.trim() !== '' && !LINK_RE.test(c.link.trim())
        const files = c.assets ?? []
        const folders = c.folders ?? []
        return (
          <div key={i} className="credit">
            <div className="row">
              <input
                className={`input grow${c.name.trim() ? '' : ' invalid'}`}
                placeholder={t('credits.name')}
                value={c.name}
                maxLength={80}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
              <button className="btn ghost icon" title={t('credits.remove')} onClick={() => save(credits.filter((_, k) => k !== i))}>
                ×
              </button>
            </div>
            <input className="input" placeholder={t('credits.work')} value={c.work} maxLength={200} onChange={(e) => patch(i, { work: e.target.value })} />
            <input
              className={`input${badLink ? ' invalid' : ''}`}
              placeholder="https://…"
              value={c.link}
              maxLength={300}
              onChange={(e) => patch(i, { link: e.target.value })}
            />
            {badLink && <span className="hint warn">{t('credits.badLink')}</span>}
            <div className="credit-files">
              {folders.map((d) => (
                <span key={d} className="chip" title={t('credits.folderHint', { folder: d })}>
                  📁 {d}/
                  <button onClick={() => patch(i, { folders: folders.filter((x) => x !== d) })} aria-label={t('credits.remove')}>
                    ×
                  </button>
                </span>
              ))}
              {files.map((a) => (
                <span key={a} className="chip" title={a}>
                  {a.split('/').pop()}
                  <button onClick={() => patch(i, { assets: files.filter((x) => x !== a) })} aria-label={t('credits.remove')}>
                    ×
                  </button>
                </span>
              ))}
              <select
                className="input small"
                value=""
                onChange={(e) => {
                  const v = e.target.value
                  if (v.startsWith('dir:')) patch(i, { folders: [...folders, v.slice(4)] })
                  else if (v) patch(i, { assets: [...files, v] })
                }}
              >
                <option value="">+ {t('credits.addFile')}</option>
                <optgroup label={t('credits.folders')}>
                  {allFolders
                    .filter((d) => !folders.includes(d))
                    .map((d) => (
                      <option key={d} value={`dir:${d}`}>
                        📁 {d}/
                      </option>
                    ))}
                </optgroup>
                <optgroup label={t('credits.files')}>
                  {allFiles
                    .filter((a) => !files.includes(a))
                    .map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>
          </div>
        )
      })}
      <button className="btn ghost small" onClick={() => save([...credits, { name: '', work: '', link: '' }])}>
        + {t('credits.add')}
      </button>
    </>
  )
}

/** Pins for the summary list: growing groups collapse into one "Ingredient ×9" entry, legacy pins are left out. */
function pinSummary(def: NodeDef): { p: NodeDef['inputs'][number]; n: number }[] {
  const out: { p: NodeDef['inputs'][number]; n: number }[] = []
  const groups = new Map<string, { p: NodeDef['inputs'][number]; n: number }>()
  for (const p of [...def.inputs, ...def.outputs]) {
    if (p.legacy) continue
    const g = p.group && groups.get(p.group)
    if (g) g.n++
    else {
      const e = { p, n: 1 }
      if (p.group) groups.set(p.group, e)
      out.push(e)
    }
  }
  return out
}

export function Inspector() {
  const { t } = useTranslation()
  const selectedIds = useStoreWithEqualityFn(useStore, (s) => s.nodes.filter((n) => n.selected).map((n) => n.id), shallow)
  const node = useStore((s) => (selectedIds.length === 1 ? s.nodes.find((n) => n.id === selectedIds[0]) : undefined))
  const diags = useStoreWithEqualityFn(useStore, (s) => (node ? s.diagnostics.filter((d) => d.nodeId === node.id) : []), shallow)
  const def = node ? NODE_DEF_MAP[node.type ?? ''] : undefined
  const props = useMemo(() => (def && node ? def.props.filter((p) => !p.showIf || p.showIf(node.data)) : []), [def, node])

  if (selectedIds.length > 1) return <div className="empty">{t('ws.multiSelected', { count: selectedIds.length })}</div>
  if (!node || !def) return <ProjectSettings />
  return (
    <>
      <div className="insp-head">
        <span className="li-icon">{def.icon}</span>
        <div className="grow">
          <b>{L(def.title)}</b>
          <div className="faint">{L(CATEGORY_LABEL[def.category])}</div>
        </div>
      </div>
      <div className="insp-desc">{L(def.description)}</div>
      {node.type !== 'comment' && (
        <div className={`bool-row node-enable${node.data.disabled ? ' off' : ''}`}>
          <span>{node.data.disabled ? t('ws.disabledHint') : t('ws.enabledLabel')}</span>
          <button
            className={`switch${node.data.disabled ? '' : ' on'}`}
            role="switch"
            aria-checked={!node.data.disabled}
            title="Ctrl+E"
            onClick={() => useStore.getState().toggleDisabled([node.id])}
          />
        </div>
      )}
      {diags.length > 0 && (
        <div className="issue-list">
          {diags.map((d, i) => (
            <div key={i} className={`issue ${d.severity}`}>
              <IAlert size={14} />
              {L(d.message)}
            </div>
          ))}
        </div>
      )}
      <GiveCommand node={node} />
      <Preview node={node} />
      {node.type !== 'texture' && <TextureSlots node={node} def={def} />}
      {props.map((p) => (
        <PropField key={p.key} node={node} def={def} p={p} />
      ))}
      {def.category === 'fd' && <div className="hint muted">{t('ws.fdHint')}</div>}
      {(def.inputs.length > 0 || def.outputs.length > 0) && (
        <>
          <div className="insp-sec">
            {t('ws.inputs')} / {t('ws.outputs')}
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {pinSummary(def).map(({ p, n }, i) => (
              <span key={`${p.id}${i}`} className="badge" style={{ background: 'transparent', border: `1.5px solid ${PIN_COLORS[p.type]}` }}>
                {n > 1 ? `${L(p.label).replace(/\s*\d+$/, '')} ×${n}` : L(p.label)}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}
