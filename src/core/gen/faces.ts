/**
 * Cube faces as Minecraft models describe them, shared by the 3D icon renderer, the armor preview and
 * the model converters. Space: y up, the north face points to −z.
 */

export type V3 = [number, number, number]
export type Face = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

/** Face corners as seen from outside: top-left, top-right, bottom-right, bottom-left (box from `a` to `b`). */
export const CORNERS: Record<Face, (a: V3, b: V3) => V3[]> = {
  north: (a, b) => [
    [b[0], b[1], a[2]],
    [a[0], b[1], a[2]],
    [a[0], a[1], a[2]],
    [b[0], a[1], a[2]]
  ],
  south: (a, b) => [
    [a[0], b[1], b[2]],
    [b[0], b[1], b[2]],
    [b[0], a[1], b[2]],
    [a[0], a[1], b[2]]
  ],
  west: (a, b) => [
    [a[0], b[1], a[2]],
    [a[0], b[1], b[2]],
    [a[0], a[1], b[2]],
    [a[0], a[1], a[2]]
  ],
  east: (a, b) => [
    [b[0], b[1], b[2]],
    [b[0], b[1], a[2]],
    [b[0], a[1], a[2]],
    [b[0], a[1], b[2]]
  ],
  up: (a, b) => [
    [a[0], b[1], a[2]],
    [b[0], b[1], a[2]],
    [b[0], b[1], b[2]],
    [a[0], b[1], b[2]]
  ],
  down: (a, b) => [
    [a[0], a[1], b[2]],
    [b[0], a[1], b[2]],
    [b[0], a[1], a[2]],
    [a[0], a[1], a[2]]
  ]
}

/** The UV a Java model face gets when it has none: [u1, v1, u2, v2] from the element's box (0–16 space). */
export const DEFAULT_UV: Record<Face, (a: readonly number[], b: readonly number[]) => number[]> = {
  north: (a, b) => [16 - b[0], 16 - b[1], 16 - a[0], 16 - a[1]],
  south: (a, b) => [a[0], 16 - b[1], b[0], 16 - a[1]],
  west: (a, b) => [a[2], 16 - b[1], b[2], 16 - a[1]],
  east: (a, b) => [16 - b[2], 16 - b[1], 16 - a[2], 16 - a[1]],
  up: (a, b) => [a[0], a[2], b[0], b[2]],
  down: (a, b) => [a[0], 16 - b[2], b[0], 16 - a[2]]
}

export const isFace = (f: string): f is Face => f in CORNERS

/** Rotates point p around origin o by deg degrees about one axis (Minecraft element rotation). */
export function rotAxis(p: V3, axis: 'x' | 'y' | 'z', deg: number, o: V3): V3 {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  const x = p[0] - o[0]
  const y = p[1] - o[1]
  const z = p[2] - o[2]
  if (axis === 'x') return [x + o[0], y * c - z * s + o[1], y * s + z * c + o[2]]
  if (axis === 'y') return [x * c + z * s + o[0], y + o[1], -x * s + z * c + o[2]]
  return [x * c - y * s + o[0], x * s + y * c + o[1], z + o[2]]
}
