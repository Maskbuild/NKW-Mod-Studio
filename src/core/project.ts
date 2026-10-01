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

export const MetaSchema = z.object({
  name: z.string().trim().min(1).max(64),
  modId: z.string().regex(ID_RE),
  version: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
  authors: z.string().max(200),
  description: z.string().max(500),
  /** mod logo (a project texture) shown in Mod Menu / the mod list; default NKW logo when empty */
  icon: z.string().regex(ASSET_RE).optional(),
  /** items not wired into any Creative Tab: hidden (/give only, default) or put into a "main" tab */
  looseItems: z.enum(['hidden', 'main']).optional()
})
export type ProjectMeta = z.infer<typeof MetaSchema>

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  meta: MetaSchema,
  targets: z.array(TargetSchema).min(1).max(32),
  activeTarget: z.number().int().min(0),
  graph: z.object({
    nodes: z.array(GraphNodeSchema).max(5000),
    edges: z.array(GraphEdgeSchema).max(20000)
  }),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional()
})
export type Project = z.infer<typeof ProjectSchema>

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
