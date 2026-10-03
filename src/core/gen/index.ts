import type { ModIR } from '../ir'
import { javaPackage, type Target } from '../project'
import { genAssets } from './assets'
import { genBuild } from './build'
import { genData } from './data'
import { genJava } from './java'
import { farmersDelightFor, getProfile } from './profiles'
import type { AssetReader, GenCtx, GenFile, ResolvedDeps } from './types'

export type { GenFile, ResolvedDeps, AssetReader } from './types'

/** FD recipes, or any Farmer's Delight item/tag/block used as an ingredient, result, drop, tab entry, crop or rule. */
function usesFarmersDelight(ir: ModIR): boolean {
  if (ir.recipes.some((r) => r.kind === 'fdCutting' || r.kind === 'fdCooking')) return true
  return JSON.stringify([ir.recipes, ir.tabs, ir.blocks, ir.toolMats, ir.armorMats, ir.gameCrops, ir.breakRules]).includes('farmersdelight:')
}

function geoNames(ir: ModIR): Map<string, string> {
  const byKey = new Map<string, string>()
  const out = new Map<string, string>()
  for (const it of ir.items) {
    const g = it.armor?.geo
    if (!g) continue
    const key = [
      g.asset,
      g.texture,
      (g.java?.textures ?? []).join(','),
      g.animation?.asset ?? '',
      g.animation?.name ?? '',
      it.armor!.slot,
      JSON.stringify(g.fit ?? null)
    ].join('|')
    if (!byKey.has(key)) byKey.set(key, it.id)
    out.set(it.id, byKey.get(key)!)
  }
  return out
}

/** Generates a complete, buildable Gradle project for one loader + Minecraft version. */
export function generate(ir: ModIR, target: Target, deps: ResolvedDeps, read: AssetReader): GenFile[] {
  const p = getProfile(target.mc)
  if (!p.loaders.includes(target.loader)) throw new Error(`${target.loader} is not available for ${target.mc}`)
  const usesFD = usesFarmersDelight(ir)
  const usesGeo = ir.items.some((i) => i.armor?.geo) || ir.mobs.some((m) => m.body === 'model3d' && m.geo)
  const ctx: GenCtx = {
    ir,
    target,
    loader: target.loader,
    p,
    ns: ir.meta.modId,
    pkg: javaPackage(ir.meta),
    deps,
    read,
    fd: usesFD ? farmersDelightFor(target.loader, target.mc) : null,
    gecko: usesGeo && p.geckoArmor && !!deps.geckolib,
    geoNames: geoNames(ir),
    files: []
  }
  genBuild(ctx)
  genJava(ctx)
  genAssets(ctx)
  genData(ctx)
  return ctx.files
}

/** Pinned versions used when the online lookup fails (verified builds). */
export const FALLBACK_DEPS: Record<string, Partial<ResolvedDeps>> = {
  '1.16.5': { fabricApi: '0.42.0+1.16', forge: '1.16.5-36.2.42' },
  '1.18.2': { fabricApi: '0.77.0+1.18.2', forge: '1.18.2-40.3.12' },
  '1.19.2': { fabricApi: '0.77.0+1.19.2', forge: '1.19.2-43.5.2' },
  '1.20.1': { fabricApi: '0.92.12+1.20.1', forge: '1.20.1-47.4.10' },
  '1.20.4': { fabricApi: '0.97.3+1.20.4', forge: '1.20.4-49.2.0', neoforge: '20.4.251' },
  '1.21.1': { fabricApi: '0.116.17+1.21.1', forge: '1.21.1-52.1.0', neoforge: '21.1.252' },
  '1.21.4': { fabricApi: '0.119.4+1.21.4', forge: '1.21.4-54.1.14', neoforge: '21.4.158' }
}

export const TOOL_VERSIONS = {
  gradle: '8.14.3',
  /** Fabric's current Loom needs Gradle 9 */
  gradleFabric: '9.7.1',
  loom: '1.17.21',
  fabricLoader: '0.17.2',
  quiltLoader: '0.29.2',
  forgeGradle: '[6.0,6.2)',
  mdg: '2.0.107'
}

/** Gradle version shipped by each official Forge MDK (older ForgeGradle setups break on newer Gradle). */
export const FORGE_GRADLE: Record<string, string> = {
  '1.16.5': '8.4',
  '1.18.2': '8.8',
  '1.19.2': '8.8',
  '1.20.1': '8.8',
  '1.20.4': '8.12.1',
  '1.21.1': '8.12.1',
  '1.21.4': '8.12.1'
}

/** Gradle before 8.5 cannot run on Java 21. */
export function gradleJvmFor(gradle: string): 17 | 21 {
  const [a, b] = gradle.split('.').map(Number)
  return a < 8 || (a === 8 && b < 5) ? 17 : 21
}
