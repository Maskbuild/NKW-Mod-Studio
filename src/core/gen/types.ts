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
}

export interface AssetReader {
  /** read a project asset as UTF-8 text */
  readText(asset: string): string
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
}

export const RES = 'src/main/resources'

export function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n'
}

export const fabricLike = (l: Loader) => l === 'fabric' || l === 'quilt'
