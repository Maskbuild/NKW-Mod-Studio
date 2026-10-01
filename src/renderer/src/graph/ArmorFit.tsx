import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { NO_FIT, parseFit, type ArmorFit, type V3 } from '@core/gen/geo'
import type { ArmorSlot } from '@core/ir'
import { inputSource, useStore, type FlowNode } from '../store'
import { vanillaSkinUrl } from '../api'
import { useActiveMc } from './VanillaPanel'

const ArmorPreview = lazy(() => import('./ArmorPreview'))

const load = (k: string, def: string) => {
  try {
    return localStorage.getItem(k) ?? def
  } catch {
    return def
  }
}
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* preview preference only */
  }
}

/** Geo model + texture wired into an armor piece (through reroutes). */
function useWiredGeo(nodeId: string): { asset: string | null; texture: string | null; javaTextures: string[] | null } {
  return useStoreWithEqualityFn(
    useStore,
    (s) => {
      const follow = (target: string, handle: string) => inputSource(s.nodes, s.edges, target, handle)
      const geo = follow(nodeId, 'geo')
      const assetOf = (n: FlowNode | undefined) => (n?.type === 'texture' && typeof n.data.asset === 'string' && n.data.asset ? n.data.asset : null)
      const asset = geo && typeof geo.data.asset === 'string' && geo.data.asset ? geo.data.asset : null
      if (geo?.type === 'model') {
        // Java block/item model worn as armor: its textures in slot order
        const slots = Math.min(4, Math.max(1, Number(geo.data.textureSlots ?? 1)))
        const list = Array.from({ length: slots }, (_, i) => assetOf(follow(geo.id, `tex${i}`))).filter((t): t is string => !!t)
        return { asset, texture: list[0] ?? null, javaTextures: list.length ? list : null }
      }
      if (geo?.type !== 'geoModel') return { asset: null, texture: null, javaTextures: null }
      return { asset, texture: assetOf(follow(geo.id, 'texture')), javaTextures: null }
    },
    shallow
  )
}

function Axis({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onStart
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onStart: () => void
}) {
  return (
    <div className="fit-axis">
      <span className="fit-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={onStart} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        className="input mono"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onFocus={onStart}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
    </div>
  )
}

/** Armor piece: 3D preview on a Steve/Alex mannequin and the fit (position / rotation / size). */
export function ArmorFitField({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const { asset, texture, javaTextures } = useWiredGeo(node.id)
  const textures = useStore((s) => s.assets).filter((a) => a.kind === 'texture')
  const [slim, setSlim] = useState(load('nkw.preview.slim', '0') === '1')
  const [skin, setSkin] = useState(load('nkw.preview.skin', ''))
  const [lock, setLock] = useState(true)
  const mc = useActiveMc()
  const slot = (['helmet', 'chestplate', 'leggings', 'boots'].includes(String(node.data.slot)) ? node.data.slot : 'helmet') as ArmorSlot
  const fit: ArmorFit = parseFit(node.data.fit) ?? NO_FIT
  const skinValid = !!skin && textures.some((a) => a.asset === skin)

  const set = (next: ArmorFit) => useStore.getState().updateData(node.id, { fit: next })
  const start = () => useStore.getState().checkpoint()
  const axis = (key: keyof ArmorFit, i: number, v: number) => {
    const vec = [...fit[key]] as V3
    if (key === 'scale' && lock) vec[0] = vec[1] = vec[2] = v
    else vec[i] = v
    set({ ...fit, [key]: vec })
  }
  const XYZ = ['X', 'Y', 'Z']

  return (
    <div className="field armor-fit">
      <label>{t('fit.title')}</label>
      <div className="row fit-tools">
        <div className="seg">
          <button className={`btn${!slim ? ' on' : ''}`} onClick={() => (setSlim(false), save('nkw.preview.slim', '0'))}>
            Steve
          </button>
          <button className={`btn${slim ? ' on' : ''}`} onClick={() => (setSlim(true), save('nkw.preview.slim', '1'))}>
            Alex
          </button>
        </div>
        <select
          className="input grow"
          value={skinValid ? skin : ''}
          title={t('fit.skinHint')}
          onChange={(e) => {
            setSkin(e.target.value)
            save('nkw.preview.skin', e.target.value)
          }}
        >
          <option value="">{t('fit.defaultSkin')}</option>
          {textures.map((a) => (
            <option key={a.asset} value={a.asset}>
              {a.asset.replace(/^textures\//, '')}
            </option>
          ))}
        </select>
      </div>
      <Suspense fallback={<div className="preview3d armor-preview" />}>
        <ArmorPreview
          geoAsset={asset}
          texture={texture}
          javaTextures={javaTextures}
          slot={slot}
          fit={fit}
          slim={slim}
          skin={skinValid ? skin : null}
          gameSkin={mc ? vanillaSkinUrl(mc, slim) : null}
        />
      </Suspense>
      {!asset ? (
        <span className="hint">{t('fit.noModel')}</span>
      ) : (
        <>
          <div className="fit-sec">{t('fit.position')}</div>
          {XYZ.map((a, i) => (
            <Axis key={a} label={a} value={fit.offset[i]} min={-16} max={16} step={0.25} onStart={start} onChange={(v) => axis('offset', i, v)} />
          ))}
          <div className="fit-sec">{t('fit.rotation')}</div>
          {XYZ.map((a, i) => (
            <Axis key={a} label={a} value={fit.rotation[i]} min={-180} max={180} step={1} onStart={start} onChange={(v) => axis('rotation', i, v)} />
          ))}
          <div className="fit-sec row">
            <span className="grow">{t('fit.size')}</span>
            <label className="row fit-lock">
              <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
              {t('fit.lock')}
            </label>
          </div>
          {(lock ? ['×'] : XYZ).map((a, i) => (
            <Axis key={a} label={a} value={fit.scale[i]} min={0.1} max={4} step={0.05} onStart={start} onChange={(v) => axis('scale', i, v)} />
          ))}
          <div className="row">
            <span className="hint grow">{t('fit.hint')}</span>
            <button
              className="btn"
              onClick={() => {
                start()
                useStore.getState().updateData(node.id, { fit: null })
              }}
            >
              {t('fit.reset')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
