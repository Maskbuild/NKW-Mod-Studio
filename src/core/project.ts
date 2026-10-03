import { z } from 'zod'

export const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'] as const
export type Loader = (typeof LOADERS)[number]

export const LOADER_LABEL: Record<Loader, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** Registry / resource ids: lowercase, digits and underscore. */
export const ID_RE = /^[a-z][a-z0-9_]{0,62}$/
/** Namespaced ids such as minecraft:diamond or c:ingots/iron. */
export const NSID_RE = /^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,128}$/
/** Project-relative asset paths created by the importer: a top-level folder, up to 4 sub-folders, then the file. */
export const ASSET_RE = /^(textures|models|geo|sounds|animations)(\/[a-z0-9_]{1,64}){0,4}\/[a-z0-9_]{1,64}\.(png|json|bbmodel|ogg)$/

export const TargetSchema = z.object({
  loader: z.enum(LOADERS),
  mc: z.string().regex(/^\d+\.\d+(\.\d+)?$/)
})
export type Target = z.infer<typeof TargetSchema>

export const GraphNodeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  type: z.string().regex(/^[a-zA-Z0-9]{1,40}$/),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.record(z.string(), z.unknown()),
  width: z.number().finite().optional(),
  height: z.number().finite().optional()
})
export type GraphNode = z.infer<typeof GraphNodeSchema>

export const GraphEdgeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_:.-]{1,200}$/),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string()
})
export type GraphEdge = z.infer<typeof GraphEdgeSchema>

/** A folder of the project's assets, e.g. "textures" or "textures/gui". */
export const FOLDER_RE = /^(textures|models|geo|sounds|animations)(\/[a-z0-9_]{1,64}){0,4}$/

const CreditSchema = z.object({
  name: z.string().max(80),
  /** what they made, e.g. "Ruby texture" */
  work: z.string().max(200),
  link: z.string().max(300),
  /** project files they made */
  assets: z.array(z.string().regex(ASSET_RE)).max(50).optional(),
  /** project folders they made (every file inside, including files added later) */
  folders: z.array(z.string().regex(FOLDER_RE)).max(20).optional()
})

/** License choices offered in the editor (SPDX ids); anything else is a custom name. */
export const LICENSES = [
  'All-Rights-Reserved',
  'MIT',
  'Apache-2.0',
  'GPL-3.0-only',
  'LGPL-3.0-only',
  'MPL-2.0',
  'Zlib',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0'
] as const

export const MetaSchema = z.object({
  name: z.string().trim().min(1).max(64),
  modId: z.string().regex(ID_RE),
  version: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
  authors: z.string().max(200),
  description: z.string().max(500),
  /** mod logo (a project texture) shown in Mod Menu / the mod list; default NKW logo when empty */
  icon: z.string().regex(ASSET_RE).optional(),
  /** items not wired into any Creative Tab: hidden (/give only, default) or put into a "main" tab */
  looseItems: z.enum(['hidden', 'main']).optional(),
  /** SPDX id (e.g. MIT), "All-Rights-Reserved" (default) or a custom license name */
  license: z.string().max(64).optional(),
  /** optional full license text, shipped as LICENSE.txt inside the jar */
  licenseText: z.string().max(50000).optional(),
  /** people who made the mod's assets (or anything else); kept loose so half-typed rows still save */
  credits: z.array(CreditSchema).max(100).optional(),
  /** mod web page and issue tracker (Website / Issues buttons in Mod Menu and the mod list) */
  homepage: z.string().max(300).optional(),
  issues: z.string().max(300).optional()
})
export type ProjectMeta = z.infer<typeof MetaSchema>
export type Credit = z.infer<typeof CreditSchema>

/** A web link shown in credits: http(s) only. */
export const LINK_RE = /^https?:\/\/[^\s"<>]+$/

/** Credits that are complete enough to ship: a name, and a link only when it is a valid web address. */
export function shippedCredits(meta: ProjectMeta): Credit[] {
  return (meta.credits ?? [])
    .filter((c) => c.name.trim())
    .map((c) => ({ ...c, name: c.name.trim(), work: c.work.trim(), link: LINK_RE.test(c.link.trim()) ? c.link.trim() : '' }))
}

/** "fabric-1.21.1:src/main/java/…/ModItems.java" — a plain relative path, no ".." */
export const OVERRIDE_KEY_RE = /^[a-z]+-[0-9.]+:(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]{0,300}$/

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  meta: MetaSchema,
  targets: z.array(TargetSchema).min(1).max(32),
  activeTarget: z.number().int().min(0),
  graph: z.object({
    nodes: z.array(GraphNodeSchema).max(5000),
    edges: z.array(GraphEdgeSchema).max(20000)
  }),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  /** generated files edited in the code view: "loader-mc:path" → text used instead of the generated one */
  overrides: z
    .record(z.string().regex(OVERRIDE_KEY_RE), z.string().max(1_000_000))
    .refine((o) => Object.keys(o).length <= 300, 'Too many edited files')
    .optional()
})
export type Project = z.infer<typeof ProjectSchema>

/** Key of an edited generated file: the target plus the file's path in the generated project. */
export const overrideKey = (t: Target, path: string) => `${t.loader}-${t.mc}:${path}`

export function javaPackage(meta: ProjectMeta): string {
  return `com.nkw.${meta.modId}`
}

export function newProject(meta: ProjectMeta, targets: Target[]): Project {
  return {
    schemaVersion: 1,
    meta,
    targets,
    activeTarget: 0,
    graph: { nodes: [], edges: [] }
  }
}

/** Turns a display name into a safe registry id ("Ruby Sword" -> "ruby_sword"). */
export function toId(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
  return id.slice(0, 48) || 'unnamed'
}
