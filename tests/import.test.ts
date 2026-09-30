import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONVERT_LIMIT, detectKind, importAsset } from '../src/main/services/assets'

/** 1 second of 16-bit mono 44.1 kHz silence-ish tone as a WAV file. */
function wav(seconds = 1): Buffer {
  const rate = 44100
  const n = rate * seconds
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + n * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2)
  return b
}

describe('asset import', () => {
  it('has a positive 2 GB limit for convertible audio/video', () => {
    // regression: `2048 << 20` overflowed to a negative number and rejected every file
    expect(CONVERT_LIMIT).toBe(2 * 1024 ** 3)
  })

  it('converts a small WAV with a Thai file name to OGG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nkw-import-'))
    mkdirSync(join(dir, 'proj', 'assets'), { recursive: true })
    const src = join(dir, 'เพลงทดสอบ.wav')
    writeFileSync(src, wav(2))
    expect(await detectKind(src)).toBe('sound')
    const [a] = await importAsset(join(dir, 'proj'), src, 'sound')
    expect(a.asset).toBe('sounds/sound.ogg')
    expect(a.seconds).toBeCloseTo(2, 0)
  }, 30000)
})
