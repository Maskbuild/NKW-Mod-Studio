import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FALLBACK_DEPS, FORGE_GRADLE, TOOL_VERSIONS } from '@core/gen/index'
import { farmersDelightFor } from '@core/gen/profiles'
import type { ResolvedDeps } from '@core/gen/types'
import type { LinkedMod, Target } from '@core/project'
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

interface MrVersion {
  id: string
  project_id: string
  version_type: string
  dependencies?: { version_id?: string | null; project_id?: string | null; dependency_type: string }[]
}

const ID_RE = /^[A-Za-z0-9]{1,64}$/

/** The newest version (release first) of a Modrinth project for a Minecraft version and loader, or null. */
async function mrVersion(project: string, mc: string, loader: string): Promise<MrVersion | null> {
  const list = await getJson<MrVersion[]>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(project)}/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  )
  return list.find((v) => v.version_type === 'release') ?? list[0] ?? null
}

/**
 * Maven coordinates (maven.modrinth:<slug>:<version id>) of a linked Modrinth mod for a target, followed by
 * the mods it requires (Modrinth's Maven does not bring those). Empty when it has no build for the target.
 */
async function linkedCoords(slug: string, mc: string, loader: string): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const slugs = new Map<string, string>()
  const slugOf = async (project: string) => {
    if (!slugs.has(project)) slugs.set(project, (await getJson<{ slug: string }>(`https://api.modrinth.com/v2/project/${encodeURIComponent(project)}`)).slug)
    return slugs.get(project)!
  }
  const visit = async (v: MrVersion, depth: number) => {
    if (seen.has(v.project_id) || !ID_RE.test(v.id)) return
    seen.add(v.project_id)
    const s = await slugOf(v.project_id)
    if (!/^[a-z0-9_-]{1,64}$/.test(s)) return
    out.push(`maven.modrinth:${s}:${v.id}`)
    if (depth >= 3) return
    for (const d of v.dependencies ?? []) {
      if (d.dependency_type !== 'required') continue
      try {
        const dep = d.version_id
          ? await getJson<MrVersion>(`https://api.modrinth.com/v2/version/${encodeURIComponent(d.version_id)}`)
          : d.project_id
            ? await mrVersion(d.project_id, mc, loader)
            : null
        if (dep) await visit(dep, depth + 1)
      } catch {
        /* a dependency that cannot be found: the game will say what is missing */
      }
    }
  }
  const v = await mrVersion(slug, mc, loader)
  if (v) await visit(v, 0)
  return out
}

/** Linked mods for test runs: Modrinth mods as Maven coordinates (with what they need). */
export async function linkedModDeps(mods: LinkedMod[], target: Target, cacheDir: string): Promise<string[]> {
  const loader = target.loader === 'quilt' ? 'fabric' : target.loader
  const out: string[] = []
  for (const m of mods) {
    if (m.source !== 'modrinth' || !m.role || m.role === 'none') continue
    const v = await cached(cacheDir, `linked:${m.id}:${target.mc}:${loader}`, async () => (await linkedCoords(m.id, target.mc, loader)).join(' '))
    for (const c of (v ?? '').split(' ').filter(Boolean)) if (!out.includes(c)) out.push(c)
  }
  return out
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

  // AppleSkin shows hunger / saturation of food in test runs (not a dependency of the mod)
  {
    const mrLoader = loader === 'quilt' ? 'fabric' : loader
    const v = await cached(cacheDir, `appleskin-id:${mc}:${mrLoader}`, () => modrinth('appleskin', mc, mrLoader, true))
    deps.appleSkin = v ? `maven.modrinth:appleskin:${v}` : null
    if (v && mrLoader === 'fabric') {
      const cloth = await cached(cacheDir, `cloth-config-id:${mc}`, () => modrinth('cloth-config', mc, 'fabric', true))
      deps.clothConfig = cloth ? `maven.modrinth:cloth-config:${cloth}` : null
    }
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
