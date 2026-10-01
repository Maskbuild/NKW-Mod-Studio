import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Only these hosts may be contacted (every redirect hop is checked too). */
const ALLOWED_HOSTS = [
  'api.adoptium.net',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'services.gradle.org',
  'downloads.gradle.org',
  'downloads.gradle-dn.com',
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'meta.quiltmc.org',
  'maven.quiltmc.org',
  'files.minecraftforge.net',
  'maven.minecraftforge.net',
  'maven.neoforged.net',
  'api.modrinth.com',
  'cdn.modrinth.com',
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launchermeta.mojang.com',
  'resources.download.minecraft.net'
]

function assertAllowed(url: string): URL {
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error(`Blocked non-HTTPS URL: ${url}`)
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`Blocked host: ${u.hostname}`)
  return u
}

const UA = 'NKW-Mod-Studio/0.1 (Nam Kueap Wan)'

async function fetchFollow(url: string, timeoutMs: number): Promise<Response> {
  let current = url
  for (let hop = 0; hop < 8; hop++) {
    assertAllowed(current)
    const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`Redirect without location from ${current}`)
      current = new URL(loc, current).toString()
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${current}`)
    return res
  }
  throw new Error(`Too many redirects for ${url}`)
}

export async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetchFollow(url, timeoutMs)
  return (await res.json()) as T
}

export async function getText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetchFollow(url, timeoutMs)
  return await res.text()
}

/**
 * Downloads to `dest` (atomically) and verifies the SHA-256 checksum.
 */
export async function download(
  url: string,
  dest: string,
  checksum: string,
  onProgress?: (done: number, total: number) => void,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): Promise<void> {
  const res = await fetchFollow(url, 30 * 60 * 1000)
  const total = Number(res.headers.get('content-length') ?? 0)
  await mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  const hash = createHash(algorithm)
  let done = 0
  let last = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    done += chunk.length
    const now = Date.now()
    if (onProgress && now - last > 200) {
      last = now
      onProgress(done, total)
    }
  })
  try {
    await pipeline(body, createWriteStream(tmp))
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  const actual = hash.digest('hex')
  if (actual.toLowerCase() !== checksum.trim().toLowerCase()) {
    await rm(tmp, { force: true })
    throw new Error(`Checksum mismatch for ${url}`)
  }
  onProgress?.(done, total || done)
  await rename(tmp, dest)
}
