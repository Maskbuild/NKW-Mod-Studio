import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { NO_FIT, parseFit, type ArmorFit, type V3 } from '@core/gen/geo'
import type { ArmorSlot } from '@core/ir'
import { useStore, type FlowNode } from '../store'
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
function useWiredGeo(nodeId: string): { asset: string | null; texture: string | null } {
  return useStoreWithEqualityFn(
    useStore,
    (s) => {
      const follow = (target: string, handle: string): FlowNode | undefined => {
        let e = s.edges.find((x) => x.target === target && x.targetHandle === handle)
        for (let i = 0; e && i < 64; i++) {
          const n = s.nodes.find((x) => x.id === e!.source)
          if (n?.type !== 'reroute') return n
          e = s.edges.find((x) => x.target === n.id && x.targetHandle === 'in')
        }
        return undefined
      }
      const geo = follow(nodeId, 'geo')
      if (geo?.type !== 'geoModel') return { asset: null, texture: null }
      const tex = follow(geo.id, 'texture')
      return {
        asset: typeof geo.data.asset === 'string' && geo.data.asset ? geo.data.asset : null,
        texture: tex?.type === 'texture' && typeof tex.data.asset === 'string' ? tex.data.asset : null
      }
    },
    shallow
  )
}

function Axis({ label, value, min, max, step, onChange, onStart }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; onStart: () => void }) {
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
  const { asset, texture } = useWiredGeo(node.id)
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
        <ArmorPreview geoAsset={asset} texture={texture} slot={slot} fit={fit} slim={slim} skin={skinValid ? skin : null} gameSkin={mc ? vanillaSkinUrl(mc, slim) : null} />
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
