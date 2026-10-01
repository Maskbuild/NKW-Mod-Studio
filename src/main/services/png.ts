import { crc32, deflateSync } from 'node:zlib'

/** Tiny RGBA PNG encoder used for template placeholder textures. */
export function encodePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4
      const [r, g, b, a] = pixel(x, y)
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Deterministic pixel-art placeholder: a shaded gem/cube pattern in the given colour. */
export function placeholder(kind: 'gem' | 'block' | 'ingot' | 'disc' | 'food' | 'armor' | 'sword', rgb: [number, number, number], w = 16, h = 16): Buffer {
  const shade = (k: number): [number, number, number, number] => [
    Math.min(255, Math.round(rgb[0] * k)),
    Math.min(255, Math.round(rgb[1] * k)),
    Math.min(255, Math.round(rgb[2] * k)),
    255
  ]
  const clear: [number, number, number, number] = [0, 0, 0, 0]
  return encodePng(w, h, (x, y) => {
    const cx = x - 7.5
    const cy = y - 7.5
    switch (kind) {
      case 'block': {
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        const noise = ((x * 7 + y * 13) % 5) / 20
        return edge ? shade(0.6) : shade(0.85 + noise)
      }
      case 'gem': {
        const dd = Math.abs(cx) + Math.abs(cy)
        if (dd > 7) return clear
        return shade(dd > 6 ? 0.55 : cx + cy < 0 ? 1.15 : 0.85)
      }
      case 'ingot': {
        if (y < 5 || y > 10 || x < 2 || x > 13) return clear
        return shade(y === 5 ? 1.2 : y === 10 ? 0.6 : 0.9)
      }
      case 'disc': {
        const r = Math.hypot(cx, cy)
        if (r > 7) return clear
        if (r < 1.5) return [20, 20, 20, 255]
        if (r < 3.2) return shade(1)
        return r > 6.2 ? [40, 40, 40, 255] : [25, 25, 25, 255]
      }
      case 'food': {
        const r = Math.hypot(cx, cy * 1.4)
        if (r > 7) return clear
        return y > 9 ? [200, 200, 205, 255] : shade(r > 5.5 ? 0.7 : 1)
      }
      case 'sword': {
        if (x + y >= 13 && x + y <= 16 && x > 2 && y > 2 && Math.abs(x - (15 - y)) <= 1) return shade(1.1)
        if (x - y >= -1 && x - y <= 1 && x < 6) return [110, 70, 30, 255]
        return clear
      }
      case 'armor':
        return (x + y) % 3 === 0 ? shade(1) : shade(0.8)
    }
  })
}
