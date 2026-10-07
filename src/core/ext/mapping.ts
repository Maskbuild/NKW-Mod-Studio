import { z } from 'zod'
import type { GraphNode } from '../project'
import { ID_RE, NSID_RE } from '../project'
import type { L10n } from '../l10n'
import { exprCalls, exprNames, evalExpr, MATH_FNS, parseExpr, truthy, type Expr, type ExprFn } from './expr'

/**
 * Declarative "node → mod data" rules of an extension. A node says which values it copies into the
 * extension's slots of the compiled mod (`ModIR.ext[extId][slot]`), how each is cleaned up (clamped,
 * defaulted, limited to a list of choices …) and which checks report problems. No code: every value is
 * read with one of a few fixed source kinds, and `computed` / `if` use the expression language.
 */

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const L10nSchema = z.strictObject({ en: z.string().max(400), th: z.string().max(400) })

export const SourceSchema = z.union([
  /** a property of the node (or one the extension added to a core node), cleaned up by `as` */
  z.strictObject({
    prop: z.string().regex(FIELD),
    as: z.enum(['string', 'number', 'int', 'bool', 'list', 'nsid', 'nsidList']).optional(),
    default: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    /** multiplies a number before it is rounded (seconds → ticks: mul 20) */
    mul: z.number().optional(),
    /** only these values are accepted (anything else becomes the default) */
    values: z.array(z.string().max(80)).max(64).optional(),
    trim: z.boolean().optional()
  }),
  /** what is wired into an input pin: the value another extension node made, or the id of a game object */
  z.strictObject({ input: z.string().regex(FIELD), required: z.boolean().optional() }),
  z.strictObject({ const: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.strictObject({ nodeId: z.literal(true) }),
  z.strictObject({ computed: z.string().max(1000) }),
  /** derive only: a value of the item being turned into a new record */
  z.strictObject({ item: z.string().max(200) })
])
export type Source = z.infer<typeof SourceSchema>

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
  diag(severity: 'error' | 'warning', nodeId: string | undefined, msg: L10n): void
}

export interface MappedExtension {
  id: string
  /** node type → its rules */
  compile: Map<string, NodeCompile>
  derive: Derive[]
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
  isId: (x) => typeof x === 'string' && ID_RE.test(x),
  isNsid: (x) => typeof x === 'string' && NSID_RE.test(x)
}

/** Runs the rules of every extension over the graph and fills `bag`. */
export function runMappings(exts: MappedExtension[], host: MappingHost, bag: ExtBag): void {
  const owner = new Map<string, { ext: MappedExtension; spec: NodeCompile }>()
  for (const ext of exts) for (const [type, spec] of ext.compile) owner.set(type, { ext, spec })
  const memo = new Map<string, Record<string, unknown> | null>()
  const busy = new Set<string>()

  const slotOf = (extId: string, slot: string) => ((bag[extId] ??= {})[slot] ??= [])

  const input = (nodeId: string, handle: string): unknown => {
    const src = host.source(nodeId, handle)
    if (!src) return undefined
    return owner.has(src.node.type) ? valueOf(src.node.id) : host.idOf(src.node, src.handle)
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
    const { ext, spec } = own
    const props = { ...(ext.defaults.get(node.type) ?? {}), ...node.data }
    const inputs = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' ? input(nodeId, k) : undefined),
      has: () => true
    })
    const v: Record<string, unknown> = {}
    const scope = { prop: props, v, input: inputs, nodeId }
    const evalSrc = (s: Source): unknown => {
      if ('prop' in s) return clean(s, props[s.prop])
      if ('input' in s) {
        const x = input(nodeId, s.input)
        if ((x === undefined || x === null) && s.required)
          host.diag('error', nodeId, { en: `Connect something to "${s.input}"`, th: `ต้องต่อบางอย่างเข้า "${s.input}"` })
        return x ?? null
      }
      if ('const' in s) return s.const
      if ('nodeId' in s) return nodeId
      if ('computed' in s) return evalExpr(parseExpr(s.computed), { scope, fns: FNS })
      return undefined
    }
    let value: Record<string, unknown> | null = null
    if (spec.emit) {
      for (const [field, src] of Object.entries(spec.emit.value)) v[field] = evalSrc(src)
      value = { nodeId, ...v }
    }
    for (const rule of spec.validate) {
      if ('if' in rule) {
        if (truthy(evalExpr(parseExpr(rule.if), { scope, fns: FNS }))) host.diag(rule.diag, nodeId, fill(rule.msg, scope))
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
    busy.delete(nodeId)
    memo.set(nodeId, value)
    return value
  }

  for (const id of host.nodes.keys()) valueOf(id)

  // derived records: after every node emitted, in manifest order
  for (const ext of exts)
    for (const d of ext.derive) {
      const [fromExt, fromSlot] = d.from.split('.')
      const where = d.where ? parseExpr(d.where) : null
      for (const item of bag[fromExt]?.[fromSlot] ?? []) {
        const v: Record<string, unknown> = {}
        const scope = { item, v }
        if (where && !truthy(evalExpr(where, { scope, fns: FNS }))) continue
        for (const [field, src] of Object.entries(d.value)) {
          v[field] =
            'item' in src
              ? src.item.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), item)
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
  for (const s of Object.values(values ?? {})) if ('computed' in s) add(s.computed, ['prop', 'v', 'input', 'nodeId', 'item'])
  if ('validate' in c) for (const r of c.validate) if ('if' in r) add(r.if, ['prop', 'v', 'input', 'nodeId'])
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
  for (const f of exprCalls(e)) if (!(f in FNS) && !extraFns.includes(f)) return `Unknown function "${f}" in: ${src}`
  return null
}

export { FNS as MAPPING_FNS }
