import { type ChangeEvent } from 'react'

export interface RangeSliderProps {
  min?: number
  max?: number
  step?: number
  valueMin: number
  valueMax: number
  onChange: (min: number, max: number) => void
}

export function RangeSlider({
  min = 0,
  max = 64,
  step = 1,
  valueMin,
  valueMax,
  onChange
}: RangeSliderProps) {
  const currentMin = Math.min(Math.max(valueMin, min), max)
  const currentMax = Math.max(Math.min(valueMax, max), currentMin)

  const minPercent = ((currentMin - min) / (max - min)) * 100
  const maxPercent = ((currentMax - min) / (max - min)) * 100

  const handleMinChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    if (val <= currentMax) {
      onChange(val, currentMax)
    } else {
      onChange(currentMax, currentMax)
    }
  }

  const handleMaxChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    if (val >= currentMin) {
      onChange(currentMin, val)
    } else {
      onChange(currentMin, currentMin)
    }
  }

  return (
    <div className="range-slider-wrap">
      <div className="range-slider-bar">
        <div className="range-slider-track" />
        <div
          className="range-slider-highlight"
          style={{
            left: `${minPercent}%`,
            width: `${Math.max(0, maxPercent - minPercent)}%`
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentMin}
          onChange={handleMinChange}
          className="range-thumb range-thumb-min"
          aria-label="Minimum"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentMax}
          onChange={handleMaxChange}
          className="range-thumb range-thumb-max"
          aria-label="Maximum"
        />
      </div>
      <div className="range-slider-inputs">
        <input
          type="number"
          className="range-pill"
          min={min}
          max={currentMax}
          value={currentMin}
          onChange={(e) => {
            const v = Math.min(Math.max(Number(e.target.value) || 0, min), currentMax)
            onChange(v, currentMax)
          }}
        />
        <span className="range-sep">-</span>
        <input
          type="number"
          className="range-pill"
          min={currentMin}
          max={max}
          value={currentMax}
          onChange={(e) => {
            const v = Math.max(Math.min(Number(e.target.value) || 0, max), currentMin)
            onChange(currentMin, v)
          }}
        />
      </div>
    </div>
  )
}
