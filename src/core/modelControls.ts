import { z } from 'zod'

/**
 * Mouse and key layout of the model editor. Presets copy Blockbench, Autodesk Maya and Blender; every
 * binding can be changed (Settings → Model editor, or as JSON).
 */

const Button = z.enum(['left', 'middle', 'right'])
const Mod = z.enum(['none', 'alt', 'shift', 'ctrl'])
/** A mouse drag: which button, with which modifier key held. */
const Gesture = z.object({ button: Button, mod: Mod })
export type Gesture = z.infer<typeof Gesture>

/** A single key (KeyboardEvent.key, lower case) such as "g", "f", "home", "." */
const Key = z.string().regex(/^[a-z0-9.,/;'\[\]\\`-]$|^(home|end|delete|tab|space|f[1-9]|f1[0-2])$/)

export const ModelControlsSchema = z.object({
  preset: z.enum(['blockbench', 'maya', 'blender', 'custom']).default('blockbench'),
  orbit: Gesture.default({ button: 'left', mod: 'none' }),
  pan: Gesture.default({ button: 'right', mod: 'none' }),
  /** drag to zoom (the wheel always zooms) */
  zoom: Gesture.default({ button: 'middle', mod: 'none' }),
  /** turn direction: flip left/right and up/down */
  invertX: z.boolean().default(false),
  invertY: z.boolean().default(false),
  /** wheel / drag zoom direction */
  invertZoom: z.boolean().default(false),
  orbitSpeed: z.number().min(0.1).max(5).default(1),
  panSpeed: z.number().min(0.1).max(5).default(1),
  zoomSpeed: z.number().min(0.1).max(5).default(1),
  keys: z
    .object({
      select: Key.default('v'),
      move: Key.default('g'),
      scale: Key.default('s'),
      rotate: Key.default('r'),
      paint: Key.default('b'),
      frame: Key.default('f'),
      frameAll: Key.default('a')
    })
    .prefault({})
})
export type ModelControls = z.infer<typeof ModelControlsSchema>
export type ToolKey = keyof ModelControls['keys']

/** The presets. */
export const CONTROL_PRESETS: Record<'blockbench' | 'maya' | 'blender', ModelControls> = {
  blockbench: ModelControlsSchema.parse({ preset: 'blockbench' }),
  maya: ModelControlsSchema.parse({
    preset: 'maya',
    orbit: { button: 'left', mod: 'alt' },
    pan: { button: 'middle', mod: 'alt' },
    zoom: { button: 'right', mod: 'alt' },
    keys: { select: 'q', move: 'w', scale: 'r', rotate: 'e', paint: 'b', frame: 'f', frameAll: 'a' }
  }),
  blender: ModelControlsSchema.parse({
    preset: 'blender',
    orbit: { button: 'middle', mod: 'none' },
    pan: { button: 'middle', mod: 'shift' },
    zoom: { button: 'middle', mod: 'ctrl' },
    keys: { select: 'w', move: 'g', scale: 's', rotate: 'r', paint: 'b', frame: '.', frameAll: 'home' }
  })
}

/** Which navigation a mouse press starts, or null (the press is for the tools: select, gizmo, paint). */
export function gestureFor(
  c: ModelControls,
  button: number,
  e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
): 'orbit' | 'pan' | 'zoom' | null {
  const b = button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : null
  if (!b) return null
  const mod = e.altKey ? 'alt' : e.shiftKey ? 'shift' : e.ctrlKey || e.metaKey ? 'ctrl' : 'none'
  for (const g of ['orbit', 'pan', 'zoom'] as const) if (c[g].button === b && c[g].mod === mod) return g
  return null
}

/** Normalises KeyboardEvent.key for matching ("Home" → "home", " " → "space"). */
export const keyName = (key: string) => (key === ' ' ? 'space' : key.toLowerCase())
