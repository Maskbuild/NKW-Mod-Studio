import { z } from 'zod'
import type { L10n } from '../l10n'
import type { NodeDef, PinDef, PropDef } from '../nodes/defs'
import type { CategoryInfo, Contribution } from './registry'
import { compileExpr } from './expr'
import { isRange, isVersion } from './semver'
import { CompileSchema, DeriveSchema, MAPPING_FNS, checkExpr, mappingExprs, type MappedExtension, type NodeCompile } from './mapping'
import { parseEra, parseTemplate, templateInfo, TemplateError, type Template } from './tpl'
import { registry } from './registry'
import '../nodes/defs'

/**
 * The manifest (`nkw-extension.json`) and node files of an extension, and the loader that turns a set of
 * files (a folder or an unpacked zip) into something the app can register. Everything is checked here, once,
 * at install time; nothing in an extension is ever executed as code.
 */

export const MANIFEST_SCHEMA = 1
export const FILE_LIMITS = { files: 2000, total: 100_000_000, file: 20_000_000, text: 2_000_000, nodes: 200 }
/** file types an extension may never contain (it cannot run code in the app or in the user's build) */
export const FORBIDDEN_EXT = /\.(js|mjs|cjs|jar|class|exe|dll|so|dylib|bat|cmd|sh|ps1|msi|node|wasm|lnk|scr|vbs|jsx|ts)$/i

const L10nSchema = z.strictObject({ en: z.string().max(400), th: z.string().max(400) })
const ID = z.string().regex(/^[a-z][a-z0-9-]{2,40}$/)
const TYPE = z.string().regex(/^[a-zA-Z0-9]{1,40}$/)
const KEY = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,40}$/)
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const PATH = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_\-./]+$/)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..') && !p.includes('//'), 'Bad path')

const PinSpec = z.strictObject({
  id: KEY,
  label: L10nSchema,
  type: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  optional: z.boolean().optional(),
  multi: z.boolean().optional(),
  group: z.string().max(40).optional(),
  right: z.boolean().optional(),
  /** makes pins id1 … idN, labelled "<label> 1" … */
  count: z.number().int().min(1).max(32).optional()
})

const PROP_KINDS = ['id', 'text', 'int', 'float', 'bool', 'select', 'multi', 'asset', 'nsid', 'textarea', 'color', 'blockList'] as const
const PropSpec = z.strictObject({
  key: KEY,
  label: L10nSchema,
  kind: z.enum(PROP_KINDS),
  default: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z
    .array(z.strictObject({ value: z.string().max(80), label: L10nSchema }))
    .max(64)
    .optional(),
  assetKind: z.enum(['texture', 'model', 'geo', 'sound', 'animation']).optional(),
  hint: L10nSchema.optional(),
  /** expression over `data` (the node's properties) */
  showIf: z.string().max(500).optional(),
  noTags: z.boolean().optional()
})

export const NodeFileSchema = z.strictObject({
  type: TYPE,
  category: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  title: L10nSchema,
  description: L10nSchema,
  icon: z.string().max(40),
  registers: z.boolean().optional(),
  hidden: z.boolean().optional(),
  inputs: z.array(PinSpec).max(60).default([]),
  outputs: z.array(PinSpec).max(60).default([]),
  props: z.array(PropSpec).max(60).default([]),
  compile: CompileSchema.optional()
})
export type NodeFile = z.infer<typeof NodeFileSchema>

const Emit = z.union([
  z.strictObject({ kind: z.literal('java'), class: z.string().max(200), template: PATH }),
  z.strictObject({ kind: z.literal('file'), path: z.string().max(200), template: PATH })
])
const GenerateSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,40}$/),
  /** expression over the generation scope */
  when: z.string().max(500).optional(),
  /** a list to repeat over; each entry is `item` in the template */
  each: z.string().max(200).optional(),
  emit: z.array(Emit).min(1).max(20)
})

const ExtendSchema = z.strictObject({
  type: TYPE,
  props: z.array(PropSpec).max(60).default([]),
  inputs: z.array(PinSpec).max(60).default([]),
  outputs: z.array(PinSpec).max(60).default([]),
  afterProp: KEY.optional(),
  afterInput: KEY.optional(),
  /** data this extension collects from every node of that type (read props of the node, and the pins it added) */
  compile: CompileSchema.optional()
})

const HookSchema = z.strictObject({
  site: z.enum(['commonInit', 'forgeClientInit', 'fabricClientInit']),
  order: z.number().int().min(0).max(1000).default(100),
  when: z.string().max(500).optional(),
  each: z.string().max(200).optional(),
  /** one line of Java, a template */
  line: z.string().max(500)
})

export const ManifestSchema = z.strictObject({
  schema: z.literal(MANIFEST_SCHEMA),
  id: ID,
  name: L10nSchema,
  description: L10nSchema,
  version: z.string().refine(isVersion, 'Version must look like 1.2.3'),
  minApp: z.string().refine(isVersion, 'Version must look like 1.2.3').optional(),
  /** other extensions this one needs: id → version range */
  requires: z.record(ID, z.string().refine(isRange, 'Bad version range')).default({}),
  author: z.string().max(100).optional(),
  homepage: z.string().max(300).optional(),
  targets: z
    .strictObject({
      /** Minecraft versions it supports, e.g. "1.20.1+" or "1.16.5-1.18.2, 1.21+" (empty: all) */
      mc: z.string().max(100).optional(),
      loaders: z
        .array(z.enum(['fabric', 'quilt', 'forge', 'neoforge']))
        .max(4)
        .optional()
    })
    .default({}),
  categories: z
    .record(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), z.strictObject({ label: L10nSchema, color: COLOR, order: z.number().min(0).max(1000).default(500) }))
    .default({}),
  pinTypes: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), COLOR).default({}),
  nodes: z.array(PATH).max(FILE_LIMITS.nodes).default([]),
  /** properties and pins this extension adds to node types of the app or of other extensions */
  extendNodes: z.array(ExtendSchema).max(40).default([]),
  derive: z.array(DeriveSchema).max(40).default([]),
  generate: z.array(GenerateSchema).max(200).default([]),
  hooks: z.array(HookSchema).max(100).default([])
})
export type Manifest = z.infer<typeof ManifestSchema>

export type FileMap = Map<string, string | Uint8Array>

export interface LoadedExtension {
  manifest: Manifest
  nodes: NodeDef[]
  contribution: Contribution
  mapped: MappedExtension
  templates: Record<string, Template>
  /** every file, for assets the generator copies */
  files: FileMap
}

export type LoadResult = { ok: true; ext: LoadedExtension } | { ok: false; errors: string[] }

const TEMPLATE_FNS = ['any', 'reg', ...Object.keys(MAPPING_FNS)]
const SCOPE_ROOTS = ['ir', 'ext', 'profile', 'loader', 'mc', 'meta', 'item', 'loop', 'modId', 'pkg', 'forge', 'paths']

const text = (f: string | Uint8Array): string => (typeof f === 'string' ? f : new TextDecoder().decode(f))
const zerr = (e: z.ZodError, where: string) => e.issues.map((i) => `${where}: ${i.path.join('.') || '(root)'} — ${i.message}`)

export function expandPins(specs: z.infer<typeof PinSpec>[]): PinDef[] {
  const out: PinDef[] = []
  for (const s of specs) {
    const { count, ...rest } = s
    if (count === undefined) out.push(rest as PinDef)
    else for (let i = 1; i <= count; i++) out.push({ ...rest, id: `${s.id}${i}`, label: { en: `${s.label.en} ${i}`, th: `${s.label.th} ${i}` } } as PinDef)
  }
  return out
}

function buildProps(specs: z.infer<typeof PropSpec>[], path: string, dflt: Record<string, unknown>, errors: string[]): PropDef[] {
  const props: PropDef[] = []
  for (const p of specs) {
    if (p.key in dflt) errors.push(`${path}: property "${p.key}" defined twice`)
    dflt[p.key] = p.default
    let showIf: PropDef['showIf']
    if (p.showIf) {
      const bad = checkExpr(p.showIf, ['data'])
      if (bad) errors.push(`${path}: ${p.key}.showIf — ${bad}`)
      else {
        const fn = compileExpr(p.showIf)
        showIf = (data) => {
          try {
            return !!fn({ scope: { data }, fns: {} })
          } catch {
            return true
          }
        }
      }
    }
    if ((p.kind === 'select' || p.kind === 'multi') && !p.options?.length) errors.push(`${path}: ${p.key} needs options`)
    props.push({ ...p, showIf } as PropDef)
  }
  return props
}

/** Validates a set of files and builds the extension. Pure: no disk, no network, no registration. */
export function loadExtension(files: FileMap): LoadResult {
  const errors: string[] = []
  if (files.size > FILE_LIMITS.files) return { ok: false, errors: [`Too many files (${files.size})`] }
  let total = 0
  for (const [path, data] of files) {
    if (FORBIDDEN_EXT.test(path)) errors.push(`${path}: this file type is not allowed in an extension`)
    if (path.split('/').includes('..') || path.startsWith('/')) errors.push(`${path}: bad path`)
    const size = typeof data === 'string' ? data.length : data.byteLength
    total += size
    if (size > FILE_LIMITS.file) errors.push(`${path}: too large`)
  }
  if (total > FILE_LIMITS.total) errors.push('The extension is too large')
  if (errors.length) return { ok: false, errors }

  const json = (path: string): unknown => {
    const f = files.get(path)
    if (f === undefined) throw new Error(`${path}: file not found`)
    if (typeof f !== 'string' && f.byteLength > FILE_LIMITS.text) throw new Error(`${path}: too large`)
    try {
      return JSON.parse(text(f))
    } catch (e) {
      throw new Error(`${path}: not valid JSON (${(e as Error).message})`)
    }
  }

  let manifest: Manifest
  try {
    const m = ManifestSchema.safeParse(json('nkw-extension.json'))
    if (!m.success) return { ok: false, errors: zerr(m.error, 'nkw-extension.json') }
    manifest = m.data
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] }
  }

  const nodeFiles: { path: string; spec: NodeFile }[] = []
  const types = new Set<string>()
  for (const path of manifest.nodes) {
    try {
      const n = NodeFileSchema.safeParse(json(path))
      if (!n.success) {
        errors.push(...zerr(n.error, path))
        continue
      }
      if (types.has(n.data.type)) errors.push(`${path}: node type "${n.data.type}" defined twice`)
      types.add(n.data.type)
      nodeFiles.push({ path, spec: n.data })
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  // node definitions
  const nodes: NodeDef[] = []
  const compile = new Map<string, NodeCompile>()
  const defaults = new Map<string, Record<string, unknown>>()
  const mapDefaultsFor = (type: string) => defaults.get(type) ?? defaults.set(type, {}).get(type)!
  for (const { path, spec } of nodeFiles) {
    const dflt: Record<string, unknown> = {}
    const props = buildProps(spec.props, path, dflt, errors)
    const inputs = expandPins(spec.inputs)
    const outputs = expandPins(spec.outputs)
    const pinIds = new Set<string>()
    for (const p of [...inputs, ...outputs]) {
      if (pinIds.has(p.id)) errors.push(`${path}: pin "${p.id}" defined twice`)
      pinIds.add(p.id)
    }
    if (spec.compile) {
      compile.set(spec.type, spec.compile)
      for (const x of mappingExprs(spec.compile)) {
        const bad = checkExpr(x.src, x.roots)
        if (bad) errors.push(`${path}: ${bad}`)
      }
      for (const s of Object.values(spec.compile.emit?.value ?? {})) {
        if ('prop' in s && !(s.prop in dflt) && !manifest.extendNodes.some((x) => x.type === spec.type && x.props.some((p) => p.key === s.prop)))
          errors.push(`${path}: reads unknown property "${s.prop}"`)
        if ('input' in s && !inputs.some((i) => i.id === s.input)) errors.push(`${path}: reads unknown input "${s.input}"`)
        if ('item' in s || 'collect' in s) errors.push(`${path}: "item" and "collect" sources only work in derive`)
      }
    }
    defaults.set(spec.type, dflt)
    nodes.push({
      type: spec.type,
      category: spec.category,
      title: spec.title,
      description: spec.description,
      icon: spec.icon,
      inputs,
      outputs,
      props,
      registers: spec.registers,
      hidden: spec.hidden
    })
  }

  // categories used must exist (own or core)
  const ownCats = new Set(Object.keys(manifest.categories))
  const ownPins = new Set(Object.keys(manifest.pinTypes))
  for (const n of nodes) {
    if (!ownCats.has(n.category) && !registry.categories[n.category]) errors.push(`node "${n.type}": unknown category "${n.category}"`)
    for (const p of [...n.inputs, ...n.outputs])
      if (!ownPins.has(p.type) && !registry.pinColors[p.type]) errors.push(`node "${n.type}": pin "${p.id}" has unknown type "${p.type}"`)
  }

  const extend: NonNullable<Contribution['extend']> = {}
  const extendCompile = new Map<string, NodeCompile>()
  for (const x of manifest.extendNodes) {
    if (extend[x.type]) errors.push(`extendNodes: "${x.type}" listed twice`)
    const own: Record<string, unknown> = {}
    const props = buildProps(x.props, `extendNodes ${x.type}`, own, errors)
    const inputs = expandPins(x.inputs)
    const outputs = expandPins(x.outputs)
    for (const p of [...inputs, ...outputs])
      if (!ownPins.has(p.type) && !registry.pinColors[p.type]) errors.push(`extendNodes ${x.type}: pin "${p.id}" has unknown type "${p.type}"`)
    extend[x.type] = { props, inputs, outputs, afterProp: x.afterProp, afterInput: x.afterInput }
    // what the mapping may read: the node's own properties, plus what this extension adds
    const d = mapDefaultsFor(x.type)
    for (const [k, v] of Object.entries(own)) d[k] = v
    if (x.compile) {
      extendCompile.set(x.type, x.compile)
      const known = new Set([...Object.keys(own), ...(registry.map[x.type]?.props ?? []).map((p) => p.key)])
      for (const e of mappingExprs(x.compile)) {
        const bad = checkExpr(e.src, e.roots)
        if (bad) errors.push(`extendNodes ${x.type}: ${bad}`)
      }
      for (const s of Object.values(x.compile.emit?.value ?? {})) {
        if ('prop' in s && !known.has(s.prop)) errors.push(`extendNodes ${x.type}: reads unknown property "${s.prop}"`)
        if ('input' in s && !(x.inputs.some((i) => i.id === s.input) || registry.map[x.type]?.inputs.some((i) => i.id === s.input)))
          errors.push(`extendNodes ${x.type}: reads unknown input "${s.input}"`)
      }
    }
  }

  for (const d of manifest.derive)
    for (const [k, src] of Object.entries(d.value)) {
      if ('collect' in src && !d.groupBy) errors.push(`derive ${d.slot}: "${k}" uses collect without groupBy`)
      if ('prop' in src || 'input' in src || 'nodeId' in src) errors.push(`derive ${d.slot}: "${k}" can only use item, collect, const or computed`)
    }
  for (const d of manifest.derive)
    for (const x of mappingExprs(d)) {
      const bad = checkExpr(x.src, x.roots)
      if (bad) errors.push(`derive ${d.slot}: ${bad}`)
    }

  // templates
  const templates: Record<string, Template> = {}
  const loadTpl = (path: string, owner: string) => {
    if (templates[path]) return
    const f = files.get(path)
    if (f === undefined) return void errors.push(`${owner}: template "${path}" not found`)
    try {
      const tpl = parseTemplate(text(f), path)
      templates[path] = tpl
      const info = templateInfo(tpl)
      for (const n of info.names) if (!SCOPE_ROOTS.includes(n)) errors.push(`${path}: unknown name "${n}"`)
      for (const c of info.calls) if (!TEMPLATE_FNS.includes(c)) errors.push(`${path}: unknown function "${c}"`)
      for (const p of info.partials) loadTpl(p, path)
    } catch (e) {
      errors.push(e instanceof TemplateError ? e.message : `${path}: ${(e as Error).message}`)
    }
  }
  const genIds = new Set<string>()
  for (const g of manifest.generate) {
    if (genIds.has(g.id)) errors.push(`generate "${g.id}" defined twice`)
    genIds.add(g.id)
    for (const [k, v] of [
      ['when', g.when],
      ['each', g.each]
    ] as const)
      if (v) {
        const bad = checkExpr(v, SCOPE_ROOTS, ['any'])
        if (bad) errors.push(`generate "${g.id}" ${k}: ${bad}`)
      }
    for (const e of g.emit) loadTpl(e.template, `generate "${g.id}"`)
  }
  manifest.hooks.forEach((h, i) => {
    for (const [k, v] of [
      ['when', h.when],
      ['each', h.each]
    ] as const)
      if (v) {
        const bad = checkExpr(v, SCOPE_ROOTS, ['any'])
        if (bad) errors.push(`hooks[${i}] ${k}: ${bad}`)
      }
    try {
      const tpl = parseTemplate(h.line, `hooks[${i}]`)
      templates[`hook:${i}`] = tpl
      for (const n of templateInfo(tpl).names) if (!SCOPE_ROOTS.includes(n)) errors.push(`hooks[${i}]: unknown name "${n}"`)
    } catch (e) {
      errors.push(e instanceof TemplateError ? e.message : `hooks[${i}]: ${(e as Error).message}`)
    }
  })
  if (manifest.targets.mc && parseEra(manifest.targets.mc) === null) errors.push(`targets.mc: bad version range "${manifest.targets.mc}"`)

  if (errors.length) return { ok: false, errors }

  const categories: Record<string, CategoryInfo> = {}
  for (const [id, c] of Object.entries(manifest.categories)) categories[id] = { label: c.label as L10n, color: c.color, order: c.order }
  return {
    ok: true,
    ext: {
      manifest,
      nodes,
      contribution: { nodes, categories, pinTypes: manifest.pinTypes, extend },
      mapped: { id: manifest.id, compile, extend: extendCompile, derive: manifest.derive, defaults },
      templates,
      files
    }
  }
}
