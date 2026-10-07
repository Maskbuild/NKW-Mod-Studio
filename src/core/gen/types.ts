import type { ModIR } from '../ir'
import type { Loader, Target } from '../project'
import type { VersionProfile } from './profiles'

export interface GenFile {
  /** path relative to the generated project root, forward slashes */
  path: string
  text?: string
  /** copy a project asset (relative to the project folder) */
  copy?: string
  /** binary content */
  base64?: string
  /** PNG made by stacking these project textures vertically (first frame each, same width) */
  atlas?: string[]
}

/** Concrete dependency versions for one target (resolved online, with pinned fallbacks). */
export interface ResolvedDeps {
  gradle: string
  loom?: string
  fabricLoader?: string
  fabricApi?: string
  /** Mod Menu (Fabric/Quilt test runs), maven.modrinth:modmenu:<id> */
  modMenu?: string | null
  quiltLoader?: string
  /** runtime libraries Quilt Loader needs (from Quilt meta), since Fabric Loom only reads fabric-installer.json */
  quiltLibraries?: string[]
  forge?: string
  forgeGradle?: string
  neoforge?: string
  mdg?: string
  /** maven coordinates (maven.modrinth:slug:version) */
  farmersDelight?: string | null
  geckolib?: string | null
  /** AppleSkin (hunger / saturation display) for test runs only */
  appleSkin?: string | null
  /** Cloth Config, which AppleSkin needs on Fabric / Quilt (test runs only) */
  clothConfig?: string | null
  /** linked Modrinth mods for test runs, with the mods they require (maven.modrinth:slug:version) */
  linkedMods?: string[]
  /** linked .jar files for test runs (ids; the builder copies them to nkw-mods/<id>-1.jar) */
  localMods?: string[]
}

export interface AssetReader {
  /** read a project asset as UTF-8 text */
  readText(asset: string): string
}

/**
 * Places in the generated main class that features (and later extensions) add code to, instead of the
 * main class knowing about each feature. Lines are sorted by `order` (stable) when rendered.
 */
export class HookSites {
  private lines: Record<string, { order: number; text: string }[]> = {}

  /** Adds a line to a site ("commonInit": common setup; "forgeClientInit": client-only setup on Forge/NeoForge; "fabricClientInit": Fabric/Quilt client entrypoint). */
  add(site: 'commonInit' | 'forgeClientInit' | 'fabricClientInit', text: string, order = 100): void {
    ;(this.lines[site] ??= []).push({ order, text })
  }

  get(site: string): string[] {
    return (this.lines[site] ?? [])
      .map((l, i) => ({ ...l, i }))
      .sort((a, b) => a.order - b.order || a.i - b.i)
      .map((l) => l.text)
  }

  has(site: string): boolean {
    return (this.lines[site]?.length ?? 0) > 0
  }
}

export interface GenCtx {
  ir: ModIR
  target: Target
  loader: Loader
  p: VersionProfile
  ns: string
  pkg: string
  deps: ResolvedDeps
  read: AssetReader
  fd: { slug: string; knifeTag: string } | null
  gecko: boolean
  /** item id → GeckoLib resource name (items sharing an identical model share one) */
  geoNames: Map<string, string>
  files: GenFile[]
  hooks: HookSites
}

export const RES = 'src/main/resources'

export function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n'
}

export const fabricLike = (l: Loader) => l === 'fabric' || l === 'quilt'

/** Names of the Forge / NeoForge game event bus and event getters for a target (older versions name them differently). */
export function forgeNames(ctx: Pick<GenCtx, 'loader' | 'p'>) {
  const neo = ctx.loader === 'neoforge'
  const old = !neo && (ctx.p.mc === '1.16.5' || ctx.p.mc === '1.18.2')
  return {
    neo,
    old,
    base: neo ? 'net.neoforged.neoforge' : 'net.minecraftforge',
    bus: neo ? 'NeoForge.EVENT_BUS' : 'MinecraftForge.EVENT_BUS',
    busImport: neo ? 'net.neoforged.neoforge.common.NeoForge' : 'net.minecraftforge.common.MinecraftForge',
    player: old ? 'getPlayer()' : 'getEntity()',
    level: old ? 'getWorld()' : 'getLevel()'
  }
}
