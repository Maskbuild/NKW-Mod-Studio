import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FALLBACK_DEPS, FORGE_GRADLE, TOOL_VERSIONS } from '@core/gen/index'
import { farmersDelightFor } from '@core/gen/profiles'
import type { ResolvedDeps } from '@core/gen/types'
import type { Target } from '@core/project'
import { getJson, getText } from './net'

const TTL = 24 * 60 * 60 * 1000
const QUILT_FALLBACK_LIBS =
  'net.fabricmc:sponge-mixin:0.16.3+mixin.0.8.7 org.quiltmc:quilt-json5:1.0.4+final org.ow2.asm:asm:9.8 org.ow2.asm:asm-analysis:9.8 org.ow2.asm:asm-commons:9.8 org.ow2.asm:asm-tree:9.8 org.ow2.asm:asm-util:9.8 org.quiltmc:quilt-config:1.3.1'
type Cache = Record<string, { at: number; value: string | null }>

let cache: Cache | null = null
async function loadCache(dir: string): Promise<Cache> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(join(dir, 'versions-cache.json'), 'utf8')) as Cache
  } catch {
    cache = {}
  }
  return cache
}
async function saveCache(dir: string) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'versions-cache.json'), JSON.stringify(cache ?? {}))
}

async function cached(dir: string, key: string, fn: () => Promise<string | null>): Promise<string | null> {
  const c = await loadCache(dir)
  const hit = c[key]
  if (hit && Date.now() - hit.at < TTL) return hit.value
  try {
    const value = await fn()
    c[key] = { at: Date.now(), value }
    await saveCache(dir)
    return value
  } catch {
    return hit?.value ?? null // offline: use stale cache
  }
}

interface ModrinthVersion {
  id: string
  version_number: string
  version_type: string
}
/** Latest release on Modrinth; returns the version number, or the unique version id when `byId`. */
async function modrinth(slug: string, mc: string, loader: string, byId = false): Promise<string | null> {
  const url = `https://api.modrinth.com/v2/project/${slug}/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  const list = await getJson<ModrinthVersion[]>(url)
  const pick = list.find((v) => v.version_type === 'release') ?? list[0]
  if (!pick) return null
  return byId ? pick.id : pick.version_number
}

function latestFromMetadata(xml: string, prefix: string): string | null {
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => v.startsWith(prefix) && !/beta|alpha|rc/i.test(v))
  return all.length ? all[all.length - 1] : null
}

export async function resolveDeps(target: Target, cacheDir: string): Promise<ResolvedDeps> {
  const { loader, mc } = target
  const fb = FALLBACK_DEPS[mc] ?? {}
  const deps: ResolvedDeps = { gradle: loader === 'fabric' || loader === 'quilt' ? TOOL_VERSIONS.gradleFabric : TOOL_VERSIONS.gradle }

  if (loader === 'fabric' || loader === 'quilt') {
    deps.fabricApi = (await cached(cacheDir, `fabric-api:${mc}`, () => modrinth('fabric-api', mc, 'fabric'))) ?? fb.fabricApi
    if (loader === 'fabric') {
      deps.loom = TOOL_VERSIONS.loom
      deps.fabricLoader =
        (await cached(cacheDir, 'fabric-loader', async () => {
          const list = await getJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/loader')
          return list.find((l) => l.stable)?.version ?? null
        })) ?? TOOL_VERSIONS.fabricLoader
    } else {
      deps.loom = TOOL_VERSIONS.loom
      deps.quiltLoader =
        (await cached(cacheDir, 'quilt-loader', async () => {
          const list = await getJson<{ version: string }[]>('https://meta.quiltmc.org/v3/versions/loader')
          return list.find((l) => !/beta|alpha|rc|pre/i.test(l.version))?.version ?? null
        })) ?? TOOL_VERSIONS.quiltLoader
      const libs = await cached(cacheDir, `quilt-libs:${mc}:${deps.quiltLoader}`, async () => {
        const profile = await getJson<{ libraries: { name: string }[] }>(
          `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(deps.quiltLoader!)}/profile/json`
        )
        return profile.libraries
          .map((l) => l.name)
          .filter(
            (n) => /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+$/.test(n) && !/^(org.quiltmc:(quilt-loader|hashed)|net.fabricmc:intermediary):/.test(n)
          )
          .join(' ')
      })
      deps.quiltLibraries = (libs ?? QUILT_FALLBACK_LIBS).split(' ').filter(Boolean)
    }
  } else if (loader === 'forge') {
    deps.forgeGradle = TOOL_VERSIONS.forgeGradle
    deps.gradle = FORGE_GRADLE[mc] ?? TOOL_VERSIONS.gradle
    const v = await cached(cacheDir, `forge:${mc}`, async () => {
      const promos = await getJson<{ promos: Record<string, string> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
      const build = promos.promos[`${mc}-recommended`] ?? promos.promos[`${mc}-latest`]
      return build ? `${mc}-${build}` : null
    })
    deps.forge = v ?? fb.forge
  } else {
    deps.mdg = TOOL_VERSIONS.mdg
    const prefix = mc.replace(/^1\./, '') + '.'
    const v = await cached(cacheDir, `neoforge:${mc}`, async () =>
      latestFromMetadata(await getText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'), prefix)
    )
    deps.neoforge = v ?? fb.neoforge
  }

  if (loader === 'fabric' || loader === 'quilt') {
    const id = await cached(cacheDir, `modmenu-id:${mc}`, () => modrinth('modmenu', mc, 'fabric', true))
    deps.modMenu = id ? `maven.modrinth:modmenu:${id}` : null
  }

  const fd = farmersDelightFor(loader, mc)
  if (fd) {
    const mrLoader = loader === 'quilt' ? 'fabric' : loader
    const v = await cached(cacheDir, `fd-id:${fd.slug}:${mc}:${mrLoader}`, () => modrinth(fd.slug, mc, mrLoader, true))
    deps.farmersDelight = v ? `maven.modrinth:${fd.slug}:${v}` : null
  }
  if (mc === '1.20.1' || mc === '1.21.1') {
    const mrLoader = loader === 'quilt' ? 'fabric' : loader
    const v = await cached(cacheDir, `geckolib-id:${mc}:${mrLoader}`, () => modrinth('geckolib', mc, mrLoader, true))
    deps.geckolib = v ? `maven.modrinth:geckolib:${v}` : null
  }
  return deps
}
