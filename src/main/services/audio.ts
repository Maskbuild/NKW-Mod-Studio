import { spawn } from 'node:child_process'
import { open } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'

/** Audio/video formats the converter accepts (anything ffmpeg can decode that users commonly have). */
export const CONVERTIBLE = ['mp3', 'wav', 'mp4', 'm4a', 'flac', 'aac', 'webm', 'mov', 'mkv', 'wma', 'opus', 'ogg']

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error('ffmpeg is not available on this platform')
  // inside a packaged app the binary is unpacked next to app.asar
  return ffmpegPath.replace('app.asar', 'app.asar.unpacked')
}

export interface ConvertOptions {
  /** Minecraft only fades/positions mono sounds; stereo plays at the same volume everywhere */
  mono: boolean
  /** 1 = unchanged, 0.5 = half, 2 = double */
  volume: number
}

/** Converts any audio/video file to Ogg Vorbis (44.1 kHz). No shell is involved. */
export function convertToOgg(input: string, output: string, o: ConvertOptions): Promise<void> {
  const vol = Math.min(4, Math.max(0.05, o.volume))
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-map_metadata', '-1', '-ac', o.mono ? '1' : '2', '-ar', '44100']
  if (Math.abs(vol - 1) > 0.001) args.push('-filter:a', `volume=${vol.toFixed(3)}`)
  args.push('-c:a', 'libvorbis', '-q:a', '5', output)
  return new Promise((ok, fail) => {
    const p = spawn(ffmpeg(), args, { windowsHide: true, shell: false })
    let err = ''
    p.stderr.on('data', (d: Buffer) => (err += d.toString()).length > 4000 && (err = err.slice(-4000)))
    p.on('error', fail)
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`))))
  })
}

/**
 * Length of an Ogg Vorbis file in seconds: last page's granule position / sample rate.
 * Reads only the first and last few KB.
 */
export async function oggSeconds(file: string): Promise<number | null> {
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const head = Buffer.alloc(Math.min(4096, size))
    await fh.read(head, 0, head.length, 0)
    const id = head.indexOf('\x01vorbis', 0, 'latin1')
    if (id < 0) return null
    const rate = head.readUInt32LE(id + 12)
    if (!rate) return null
    const tailLen = Math.min(65536, size)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, size - tailLen)
    const last = tail.lastIndexOf('OggS', tailLen, 'latin1')
    if (last < 0 || last + 14 > tailLen) return null
    const granule = Number(tail.readBigInt64LE(last + 6))
    return granule > 0 ? Math.round((granule / rate) * 100) / 100 : null
  } finally {
    await fh.close()
  }
}
