import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useViewport, type EdgeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { IX } from '../components/Icons'
import { useStore } from '../store'

/** The × on a selected wire; keeps the same on-screen size at any zoom. */
function WireX({ id, x, y }: { id: string; x: number; y: number }) {
  const { t } = useTranslation()
  const { zoom } = useViewport()
  return (
    <EdgeLabelRenderer>
      <button
        className="wire-x nodrag nopan"
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${1 / Math.max(zoom, 0.05)})` }}
        title={t('ws.disconnectOne')}
        onClick={(e) => {
          e.stopPropagation()
          useStore.getState().disconnect([id])
        }}
      >
        <IX size={12} />
      </button>
    </EdgeLabelRenderer>
  )
}

/** A wire. When selected (click it) a × button on its middle removes just this wire. */
export const WireEdge = memo(function WireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
  markerEnd
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} style={selected ? { ...style, strokeWidth: 3.4 } : style} markerEnd={markerEnd} interactionWidth={18} />
      {selected && <WireX id={id} x={labelX} y={labelY} />}
    </>
  )
})

export const EDGE_TYPES = { default: WireEdge }
