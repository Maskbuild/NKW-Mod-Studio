import { z } from 'zod'
import type { GraphNode } from '../project'
import { ID_RE, NSID_RE } from '../project'
import type { L10n } from '../l10n'
import type { Manifest } from './manifest'
import { targetConfigFor } from './support'
import { exprCalls, exprNames, evalExpr, MATH_FNS, parseExpr, truthy, type Expr, type ExprFn } from './expr'

/**
 * Declarative "node → mod data" rules of an extension. A node says which values it copies into the
 * extension's slots of the compiled mod (`ModIR.ext[extId][slot]`), how each is cleaned up (clamped,
 * defaulted, limited to a list of choices …) and which checks report problems. No code: every value is
 * read with one of a few fixed source kinds, and `computed` / `if` use the expression language.
 */

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
/** a pin or property name, possibly with {i} for numbered slots */
const PINREF = /^[A-Za-z_][A-Za-z0-9_{}]{0,40}$/
const L10nSchema = z.strictObject({ en: z.string().max(2000), th: z.string().max(2000) })

export type Source =
  | {
      prop: string
      as?: 'string' | 'number' | 'int' | 'bool' | 'list' | 'nsid' | 'nsidList'
      default?: string | number | boolean | null | string[]
      min?: number
      max?: number
      mul?: number
      values?: string[]
      trim?: boolean
      optional?: boolean
    }
  | { input: string; required?: boolean }
  | { ingredient: string; required?: boolean }
  | { rows: { count: number; required: string; fields: Record<string, Source> } }
  | { const: string | number | boolean | null }
  | { nodeId: true }
  | { computed: string }
  | { item: string }
  | { collect: string }

export const SourceSchema: z.ZodType<Source> = z.union([
  /** a property of the node (or one the extension added to a core node), cleaned up by `as` */
  z.strictObject({
    prop: z.string().regex(PINREF),
    as: z.enum(['string', 'number', 'int', 'bool', 'list', 'nsid', 'nsidList']).optional(),
    default: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    /** multiplies a number before it is rounded (seconds → ticks: mul 20) */
    mul: z.number().optional(),
    /** only these values are accepted (anything else becomes the default) */
    values: z.array(z.string().max(80)).max(64).optional(),
    trim: z.boolean().optional(),
    /** the node may not have this property (then the default is used); skips the existence check */
    optional: z.boolean().optional()
  }),
  /** what is wired into an input pin: the value another extension node made, or the id of a game object */
  z.strictObject({ input: z.string().regex(PINREF), required: z.boolean().optional() }),
  /** what is wired into an ingredient pin: {item} or {tag} */
  z.strictObject({ ingredient: z.string().regex(PINREF), required: z.boolean().optional() }),
  /**
   * A list made from numbered slots: for i = 1..count one row is made from `fields` (where "{i}" in a property
   * or pin name becomes i). A row is left out when its `required` field is empty.
   */
  z.strictObject({
    rows: z.strictObject({
      count: z.number().int().min(1).max(32),
      required: z.string().regex(FIELD),
      fields: z
        .record(
          z.string().regex(FIELD),
          z.lazy(() => SourceSchema)
        )
        .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 12)
    })
  }),
  z.strictObject({ const: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.strictObject({ nodeId: z.literal(true) }),
  z.strictObject({ computed: z.string().max(1000) }),
  /** derive only: a value of the item being turned into a new record */
  z.strictObject({ item: z.string().max(200) }),
  /** derive with groupBy only: the list of this field of every item in the group */
  z.strictObject({ collect: z.string().max(200) })
])

const RuleSchema = z.union([
  z.strictObject({ if: z.string().max(1000), diag: z.enum(['error', 'warning']), msg: L10nSchema }),
  z.strictObject({ unique: z.string().regex(FIELD), diag: z.enum(['error', 'warning']), msg: L10nSchema })
])

const ValueSchema = z.record(z.string().regex(FIELD), SourceSchema).refine((o) => Object.keys(o).length <= 60, 'Too many fields')

export const CompileSchema = z.strictObject({
  emit: z
    .strictObject({
      slot: z.string().regex(FIELD),
      /** push: add to the slot's list. ref: only keep the value for nodes that read it through an input */
      mode: z.enum(['push', 'ref']).default('push'),
      /** only emit when this expression is true (scope: prop, input, nodeId) */
      when: z.string().max(1000).optional(),
      value: ValueSchema
    })
    .optional(),
  validate: z.array(RuleSchema).max(40).default([])
})
export type NodeCompile = z.infer<typeof CompileSchema>

export const DeriveSchema = z.strictObject({
  slot: z.string().regex(FIELD),
  /** "<extension id>.<slot>": the records to look at */
  from: z.string().regex(/^[a-z][a-z0-9-]{2,40}\.[A-Za-z_][A-Za-z0-9_]{0,40}$/),
  where: z.string().max(1000).optional(),
  /** one new record per distinct value of this field of the items (instead of one per item) */
  groupBy: z.string().regex(FIELD).optional(),
  value: ValueSchema
})
export type Derive = z.infer<typeof DeriveSchema>

/** The compiled data of all extensions: ext id → slot → records. */
export type ExtBag = Record<string, Record<string, Record<string, unknown>[]>>

export interface MappingHost {
  /** the graph nodes that are in the mod (disabled ones left out) */
  nodes: Map<string, GraphNode>
  /** the node wired into an input pin (reroutes followed) */
  source(nodeId: string, handle: string): { node: GraphNode; handle: string } | null
  /** the game id (item/block) a core node produces on a pin, or null */
  idOf(node: GraphNode, handle: string): string | null
  /** the target being compiled for (none when only checking a project) */
  target: { loader: string; mc: string } | null
  /** what is wired into an ingredient pin ({item} or {tag}), or null */
  ingredient(nodeId: string, handle: string): { item: string } | { tag: string } | null
  diag(severity: 'error' | 'warning', nodeId: string | undefined, msg: L10n): void
}

export interface MappedExtension {
  id: string
  /** node type → its rules (nodes the extension defines) */
  compile: Map<string, NodeCompile>
  /** node type → rules for nodes of other sources the extension attaches data to */
  extend: Map<string, NodeCompile>
  derive: Derive[]
  targetConfig: Manifest['targetConfig']
  /** default value of every property of a node type (so `prop` sources see defaults) */
  defaults: Map<string, Record<string, unknown>>
}

const NSID_LIST = /[\s,]+/

function clean(src: Extract<Source, { prop: string }>, raw: unknown): unknown {
  const text = (v: unknown) => (typeof v === 'string' ? (src.trim ? v.trim() : v) : v === undefined || v === null ? undefined : String(v))
  const def = src.default
  switch (src.as ?? 'string') {
    case 'string': {
      const v = text(raw) ?? (typeof def === 'string' ? def : '')
      return src.values && !src.values.includes(v) ? (typeof def === 'string' ? def : src.values[0]) : v
    }
    case 'nsid': {
      const v = (text(raw) ?? '').trim().toLowerCase()
      return NSID_RE.test(v) ? v : typeof def === 'string' ? def : ''
    }
    case 'number':
    case 'int': {
      const base = typeof raw === 'number' && Number.isFinite(raw) ? raw : typeof def === 'number' ? def : 0
      let n = Math.min(src.max ?? Infinity, Math.max(src.min ?? -Infinity, base))
      if (src.mul !== undefined) n *= src.mul
      return src.as === 'int' ? Math.round(n) : n
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : typeof def === 'boolean' ? def : false
    case 'list':
    case 'nsidList': {
      const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(NSID_LIST) : []
      const strs = items
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
      const ok = src.as === 'nsidList' ? strs.filter((x) => NSID_RE.test(x.replace(/^#/, ''))) : strs
      return [...new Set(ok)]
    }
  }
}

const fill = (m: L10n, scope: Record<string, unknown>): L10n => {
  const sub = (s: string) =>
    s.replace(/\{([A-Za-z_][\w.]*)\}/g, (_, path: string) => {
      let v: unknown = scope
      for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
      return v === undefined || v === null ? '' : String(v)
    })
  return { en: sub(m.en), th: sub(m.th) }
}

const FNS: Record<string, ExprFn> = {
  ...MATH_FNS,
  /** the text after the first separator ("mod:thing" → "thing"), or all of it when there is none */
  after: (x, sep) => {
    const t = String(x ?? '')
    const i = t.indexOf(String(sep))
    return i < 0 ? t : t.slice(i + String(sep).length)
  },
  replace: (x, a, b) =>
    String(x ?? '')
      .split(String(a))
      .join(String(b)),
  isId: (x) => typeof x === 'string' && ID_RE.test(x),
  isNsid: (x) => typeof x === 'string' && NSID_RE.test(x)
}

/** Runs the rules of every extension over the graph and fills `bag`. */
export function runMappings(exts: MappedExtension[], host: MappingHost, bag: ExtBag): void {
  /** extension nodes: the one extension that owns the type */
  const owner = new Map<string, { ext: MappedExtension; spec: NodeCompile }>()
  /** nodes of other sources that extensions attach data to (any number of extensions per type) */
  const attach = new Map<string, { ext: MappedExtension; spec: NodeCompile }[]>()
  for (const ext of exts) {
    for (const [type, spec] of ext.compile) owner.set(type, { ext, spec })
    for (const [type, spec] of ext.extend) attach.set(type, [...(attach.get(type) ?? []), { ext, spec }])
  }
  /** how many times each name was handed out (recipe_name, recipe_name_2 …) */
  const names = new Map<string, number>()
  const fns: Record<string, ExprFn> = {
    ...FNS,
    unique: (base) => {
      const b = String(base)
      const c = (names.get(b) ?? 0) + 1
      names.set(b, c)
      return c === 1 ? b : `${b}_${c}`
    }
  }
  const memo = new Map<string, Record<string, unknown> | null>()
  const busy = new Set<string>()

  const slotOf = (extId: string, slot: string) => ((bag[extId] ??= {})[slot] ??= [])

  const input = (nodeId: string, handle: string): unknown => {
    const src = host.source(nodeId, handle)
    if (!src) return undefined
    return owner.has(src.node.type) ? valueOf(src.node.id) : host.idOf(src.node, src.handle)
  }

  /** Applies one rule set to one node; returns its record. */
  const exec = (node: GraphNode, ext: MappedExtension, spec: NodeCompile): Record<string, unknown> | null => {
    const nodeId = node.id
    const props = { ...(ext.defaults.get(node.type) ?? {}), ...node.data }
    // expressions read `input.<pin>` (only pins that are wired exist)
    const inputs = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' ? input(nodeId, k) : undefined),
      getOwnPropertyDescriptor: (_t, k) => {
        const value = typeof k === 'string' ? input(nodeId, k) : undefined
        return value === undefined ? undefined : { value, enumerable: true, configurable: true, writable: false }
      }
    })
    const v: Record<string, unknown> = {}
    const scope = {
      prop: props,
      v,
      input: inputs,
      nodeId,
      target: host.target,
      cfg: host.target ? targetConfigFor({ targetConfig: ext.targetConfig }, host.target.loader, host.target.mc) : null
    }
    const evalSrc = (s: Source, i?: number): unknown => {
      const nm = (n: string) => (i === undefined ? n : n.replace(/\{i\}/g, String(i)))
      if ('prop' in s) return clean(s, props[nm(s.prop)])
      if ('input' in s) {
        const x = input(nodeId, nm(s.input))
        if ((x === undefined || x === null) && s.required)
          host.diag('error', nodeId, { en: `Connect something to "${nm(s.input)}"`, th: `ต้องต่อบางอย่างเข้า "${nm(s.input)}"` })
        return x ?? null
      }
      if ('ingredient' in s) {
        const x = host.ingredient(nodeId, nm(s.ingredient))
        if (!x && s.required)
          host.diag('error', nodeId, { en: `Connect an ingredient to "${nm(s.ingredient)}"`, th: `ต่อวัตถุดิบเข้าช่อง "${nm(s.ingredient)}"` })
        return x
      }
      if ('rows' in s) {
        const rows: Record<string, unknown>[] = []
        for (let k = 1; k <= s.rows.count; k++) {
          const row: Record<string, unknown> = {}
          for (const [f, src] of Object.entries(s.rows.fields)) row[f] = evalSrc(src, k)
          if (row[s.rows.required] !== null && row[s.rows.required] !== undefined && row[s.rows.required] !== '') rows.push(row)
        }
        return rows
      }
      if ('const' in s) return s.const
      if ('nodeId' in s) return nodeId
      if ('computed' in s) return evalExpr(parseExpr(s.computed), { scope: i === undefined ? scope : { ...scope, i }, fns })
      return undefined
    }
    let value: Record<string, unknown> | null = null
    if (spec.emit) {
      for (const [field, src] of Object.entries(spec.emit.value)) v[field] = evalSrc(src)
      if (!spec.emit.when || truthy(evalExpr(parseExpr(spec.emit.when), { scope, fns }))) value = { nodeId, ...v }
    }
    for (const rule of spec.validate) {
      if ('if' in rule) {
        if (truthy(evalExpr(parseExpr(rule.if), { scope, fns }))) host.diag(rule.diag, nodeId, fill(rule.msg, scope))
      }
    }
    if (spec.emit && value && spec.emit.mode === 'push') {
      for (const rule of spec.validate) {
        if (!('unique' in rule)) continue
        const dup = slotOf(ext.id, spec.emit.slot).some((r) => JSON.stringify(r[rule.unique]) === JSON.stringify(value![rule.unique]))
        if (dup) host.diag(rule.diag, nodeId, fill(rule.msg, scope))
      }
      slotOf(ext.id, spec.emit.slot).push(value)
    }
    return value
  }

  const valueOf = (nodeId: string): Record<string, unknown> | null => {
    if (memo.has(nodeId)) return memo.get(nodeId)!
    const node = host.nodes.get(nodeId)
    const own = node && owner.get(node.type)
    if (!node || !own) return null
    if (busy.has(nodeId)) {
      host.diag('error', nodeId, { en: 'This node is wired into itself', th: 'โหนดนี้ต่อวนเข้าตัวเอง' })
      return null
    }
    busy.add(nodeId)
    const value = exec(node, own.ext, own.spec)
    busy.delete(nodeId)
    memo.set(nodeId, value)
    return value
  }

  for (const [id, node] of host.nodes) {
    valueOf(id)
    for (const a of attach.get(node.type) ?? []) exec(node, a.ext, a.spec)
  }

  // derived records: after every node emitted, in manifest order
  for (const ext of exts)
    for (const d of ext.derive) {
      const [fromExt, fromSlot] = d.from.split('.')
      const where = d.where ? parseExpr(d.where) : null
      const read = (o: unknown, path: string) =>
        path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)
      const groups = new Map<string, Record<string, unknown>[]>()
      for (const item of bag[fromExt]?.[fromSlot] ?? []) {
        if (where && !truthy(evalExpr(where, { scope: { item, v: {} }, fns: FNS }))) continue
        const key = d.groupBy ? JSON.stringify(item[d.groupBy]) : String(groups.size)
        groups.set(key, [...(groups.get(key) ?? []), item])
      }
      for (const group of groups.values()) {
        const item = group[0]
        const v: Record<string, unknown> = {}
        const scope = { item, v }
        for (const [field, src] of Object.entries(d.value)) {
          v[field] =
            'item' in src
              ? read(item, src.item)
              : 'collect' in src
                ? group.map((g) => read(g, src.collect))
                : 'const' in src
                  ? src.const
                  : 'computed' in src
                    ? evalExpr(parseExpr(src.computed), { scope, fns: FNS })
                    : undefined
        }
        slotOf(ext.id, d.slot).push(v)
      }
    }
}

/** Names the expressions of a rule set read, and functions they call, for install-time validation. */
export function mappingExprs(c: NodeCompile | Derive): { src: string; roots: string[] }[] {
  const out: { src: string; roots: string[] }[] = []
  const add = (src: string, roots: string[]) => out.push({ src, roots })
  const values = 'value' in c ? c.value : c.emit?.value
  for (const s of Object.values(values ?? {})) if ('computed' in s) add(s.computed, ['prop', 'v', 'input', 'nodeId', 'item', 'target', 'cfg', 'i'])
  if ('emit' in c && c.emit?.when) add(c.emit.when, ['prop', 'v', 'input', 'nodeId', 'target', 'cfg'])
  if ('validate' in c) for (const r of c.validate) if ('if' in r) add(r.if, ['prop', 'v', 'input', 'nodeId', 'target', 'cfg'])
  if ('where' in c && c.where) add(c.where, ['item', 'v'])
  return out
}

/** Parses and checks one expression: syntax, names and functions. Returns a problem text or null. */
export function checkExpr(src: string, roots: string[], extraFns: string[] = []): string | null {
  let e: Expr
  try {
    e = parseExpr(src)
  } catch (err) {
    return `${(err as Error).message}: ${src}`
  }
  for (const n of exprNames(e)) if (!roots.includes(n)) return `Unknown name "${n}" in: ${src}`
  for (const f of exprCalls(e)) if (!(f in FNS) && f !== 'unique' && !extraFns.includes(f)) return `Unknown function "${f}" in: ${src}`
  return null
}

export { FNS as MAPPING_FNS }

/**
 * Checks the sources of a node's rules against the node: every property and pin they read must exist
 * (numbered "{i}" names are checked for each row), and "item" / "collect" belong to derive only.
 */
export function sourceProblems(values: Record<string, Source> | undefined, props: Set<string>, pins: Set<string>): string[] {
  const out: string[] = []
  const visit = (s: Source, i?: number) => {
    const nm = (n: string) => (i === undefined ? n : n.replace(/\{i\}/g, String(i)))
    if ('prop' in s) {
      if (!s.optional && !props.has(nm(s.prop))) out.push(`reads unknown property "${nm(s.prop)}"`)
    } else if ('input' in s) {
      if (!pins.has(nm(s.input))) out.push(`reads unknown input "${nm(s.input)}"`)
    } else if ('ingredient' in s) {
      if (!pins.has(nm(s.ingredient))) out.push(`reads unknown input "${nm(s.ingredient)}"`)
    } else if ('rows' in s) {
      if (!(s.rows.required in s.rows.fields)) out.push(`rows: "required" must name one of the fields`)
      for (let k = 1; k <= s.rows.count; k++) for (const f of Object.values(s.rows.fields)) visit(f, k)
    } else if ('item' in s || 'collect' in s) out.push('"item" and "collect" sources only work in derive')
  }
  for (const s of Object.values(values ?? {})) visit(s)
  return [...new Set(out)]
}
