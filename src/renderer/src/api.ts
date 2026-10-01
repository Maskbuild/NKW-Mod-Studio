import type { Project, ProjectMeta, Target } from '@core/project'
import type { VanillaData } from '@core/vanilla'

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  language: 'th' | 'en'
  memoryMb: number
  allowDownloads: boolean
  recent: { dir: string; name: string; modId: string; at: number }[]
}
export type AssetKind = 'texture' | 'model' | 'geo' | 'sound' | 'animation'
export interface AssetEntry {
  asset: string
  kind: AssetKind | 'folder'
  seconds?: number
}
export interface AudioOptions {
  mono: boolean
  volume: number
}
export interface ImportedAsset {
  asset: string
  kind: AssetKind
  seconds?: number
  name: string
  textureSlots?: number
  textures?: string[]
  animations?: string[]
  width?: number
  height?: number
  warning?: string
}
export interface Opened {
  dir: string
  project: Project
}
export type TemplateId = 'empty' | 'starter' | 'armor' | 'music' | 'farmersDelight'

const call = <T>(channel: string, arg?: unknown) => window.nkw.invoke(channel, arg) as Promise<T>

export const api = {
  appInfo: () => call<{ version: string; platform: string; electron: string }>('app:info'),
  settings: () => call<Settings>('settings:get'),
  setSettings: (patch: Partial<Omit<Settings, 'recent'>>) => call<Settings>('settings:set', patch),
  createProject: (meta: ProjectMeta, targets: Target[], template: TemplateId) => call<Opened | null>('project:create', { meta, targets, template }),
  openProject: () => call<Opened | null>('project:open'),
  openRecent: (dir: string) => call<Opened>('project:openRecent', { dir }),
  forgetRecent: (dir: string) => call<void>('project:forgetRecent', { dir }),
  saveProject: (p: Project) => call<boolean>('project:save', p),
  closeProject: () => call<boolean>('project:close'),
  revealProject: () => call<string>('project:reveal'),
  listAssets: () => call<AssetEntry[]>('assets:list'),
  importAssets: (kind: AssetKind, folder?: string, audio?: AudioOptions) => call<ImportedAsset[]>('assets:import', { kind, folder, audio }),
  importAny: (folder?: string) => call<{ imported: ImportedAsset[]; errors: string[] }>('assets:importAny', { folder }),
  convertAudio: (folder?: string, audio?: AudioOptions) => call<{ imported: ImportedAsset[]; errors: string[] }>('audio:convert', { folder, audio }),
  makeFolder: (folder: string) => call<void>('assets:mkdir', { folder }),
  moveAsset: (from: string, to: string) => call<{ from: string; to: string }[]>('assets:move', { from, to }),
  deleteAsset: (path: string) => call<string[]>('assets:delete', { path }),
  readModel: (asset: string) => call<unknown>('assets:readModel', { asset }),
  animationNames: (asset: string) => call<string[]>('assets:animationNames', { asset }),
  /** Imports files dropped from the OS; kind is detected from content unless given. */
  importFiles: (files: File[], kind?: AssetKind, folder?: string, audio?: AudioOptions) =>
    call<{ imported: ImportedAsset[]; errors: string[] }>('assets:importPaths', { paths: files.map((f) => window.nkw.pathForFile(f)).filter(Boolean).slice(0, 32), kind, folder, audio }),
  vanilla: (mc: string, source: ItemSource = 'minecraft') => call<VanillaData | null>('vanilla:get', { mc, source }),
  downloadVanilla: (mc: string, source: ItemSource = 'minecraft') => call<VanillaData | null>('vanilla:download', { mc, source }),
  toolchain: () => call<{ jdks: { major: number; home: string; managed: boolean }[]; toolsDir: string }>('toolchain:status'),
  startBuild: (project: Project, target: Target, task: 'runClient' | 'build' | 'compileJava') => call<boolean>('build:start', { project, target, task }),
  stopBuild: () => call<boolean>('build:stop'),
  openBuildFolder: (t: Target) => call<boolean>('build:openFolder', t),
  cleanBuild: (t: Target) => call<boolean>('build:clean', t),
  openExternal: (url: string) => call<boolean>('shell:openExternal', { url }),
  on: <T>(channel: 'build:log' | 'build:progress' | 'build:done' | 'vanilla:progress', cb: (p: T) => void) => window.nkw.on(channel, cb as (p: unknown) => void)
}

export const assetUrl = (asset: string) => `nkw-asset://project/${asset}`
export type ItemSource = 'minecraft' | 'farmersdelight'
/** The game's Steve / Alex skin, extracted from the downloaded Minecraft files. */
export const vanillaSkinUrl = (mc: string, slim: boolean) => `nkw-asset://vanilla/${mc}/skins/${slim ? 'alex' : 'steve'}.png`
export const vanillaIconUrl = (mc: string, id: string, ns: string = 'minecraft') => `nkw-asset://vanilla/${mc}/${ns === 'farmersdelight' ? 'farmersdelight/' : ''}${id}.png`
