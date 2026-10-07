import type { L10n } from '../l10n'
import type { NodeDef, PinDef, PropDef } from '../nodes/defs'

/**
 * The runtime registry of everything the node editor and the compiler know about: node definitions,
 * categories (the groups of the node library) and pin types. The app's own nodes are registered as the
 * source "core"; an extension registers its own under its id and takes them away again when it is turned
 * off or removed.
 *
 * The collections are shared objects that are changed in place, so code that imported `NODE_DEFS` /
 * `NODE_DEF_MAP` / `PIN_COLORS` keeps seeing the current state. `version` counts changes (for UI refresh).
 */

export interface CategoryInfo {
  label: L10n
  /** dot colour of its nodes */
  color: string
  /** position in the node library (low first) */
  order: number
}

/** Properties and pins a source adds to a node type that another source defined. */
export interface NodeExtension {
  props?: PropDef[]
  inputs?: PinDef[]
  outputs?: PinDef[]
  /** insert after this property / input (default: at the end) */
  afterProp?: string
  afterInput?: string
}

/** What one source adds. */
export interface Contribution {
  /** node type → what to add to it */
  extend?: Record<string, NodeExtension>
  nodes?: NodeDef[]
  categories?: Record<string, CategoryInfo>
  /** pin type id → wire colour */
  pinTypes?: Record<string, string>
}

const TYPE_RE = /^[a-zA-Z0-9]{1,40}$/
const ID_RE = /^[a-zA-Z0-9_-]{1,40}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

class Registry {
  /** every node definition, in registration order */
  readonly defs: NodeDef[] = []
  /** node definitions by type */
  readonly map: Record<string, NodeDef> = {}
  readonly categories: Record<string, CategoryInfo> = {}
  readonly pinColors: Record<string, string> = {}
  private owner = new Map<string, string>()
  private owned = new Map<string, Contribution>()
  private listeners = new Set<() => void>()
  version = 0

  /** Adds what a source contributes. Throws (and changes nothing) when a type, category or pin type is taken or invalid. */
  register(source: string, c: Contribution): void {
    if (this.owned.has(source)) throw new Error(`"${source}" is already registered`)
    const nodes = c.nodes ?? []
    const cats = c.categories ?? {}
    const pins = c.pinTypes ?? {}
    const seen = new Set<string>()
    for (const d of nodes) {
      if (!TYPE_RE.test(d.type)) throw new Error(`Invalid node type "${d.type}"`)
      if (this.map[d.type] || seen.has(d.type))
        throw new Error(`Node type "${d.type}" is already defined${this.owner.has(`node:${d.type}`) ? ` by "${this.owner.get(`node:${d.type}`)}"` : ''}`)
      seen.add(d.type)
    }
    const ext = c.extend ?? {}
    for (const [type, x] of Object.entries(ext)) {
      const def = this.map[type] ?? nodes.find((d) => d.type === type)
      if (!def) throw new Error(`Cannot extend "${type}": no such node type`)
      for (const p of x.props ?? []) if (def.props.some((q) => q.key === p.key)) throw new Error(`"${type}" already has a property "${p.key}"`)
      for (const p of [...(x.inputs ?? []), ...(x.outputs ?? [])])
        if ([...def.inputs, ...def.outputs].some((q) => q.id === p.id)) throw new Error(`"${type}" already has a pin "${p.id}"`)
    }
    for (const [id, info] of Object.entries(cats)) {
      if (!ID_RE.test(id)) throw new Error(`Invalid category "${id}"`)
      if (this.categories[id]) throw new Error(`Category "${id}" is already defined by "${this.owner.get(`category:${id}`)}"`)
      if (!COLOR_RE.test(info.color)) throw new Error(`Category "${id}" needs a #rrggbb colour`)
    }
    for (const [id, color] of Object.entries(pins)) {
      if (!ID_RE.test(id)) throw new Error(`Invalid pin type "${id}"`)
      if (this.pinColors[id]) throw new Error(`Pin type "${id}" is already defined by "${this.owner.get(`pin:${id}`)}"`)
      if (!COLOR_RE.test(color)) throw new Error(`Pin type "${id}" needs a #rrggbb colour`)
    }
    for (const [id, info] of Object.entries(cats)) {
      this.categories[id] = info
      this.owner.set(`category:${id}`, source)
    }
    for (const [id, color] of Object.entries(pins)) {
      this.pinColors[id] = color
      this.owner.set(`pin:${id}`, source)
    }
    for (const d of nodes) {
      this.defs.push(d)
      this.map[d.type] = d
      this.owner.set(`node:${d.type}`, source)
    }
    for (const [type, x] of Object.entries(ext)) {
      const def = this.map[type]
      const at = <T>(list: T[], add: T[], after: string | undefined, id: (v: T) => string) => {
        const i = after === undefined ? -1 : list.findIndex((v) => id(v) === after)
        list.splice(i < 0 ? list.length : i + 1, 0, ...add)
      }
      if (x.props?.length) at(def.props, x.props, x.afterProp, (v) => v.key)
      if (x.inputs?.length) at(def.inputs, x.inputs, x.afterInput, (v) => v.id)
      if (x.outputs?.length) def.outputs.push(...x.outputs)
    }
    this.owned.set(source, c)
    this.changed()
  }

  /** Takes away everything a source added. */
  unregister(source: string): void {
    const c = this.owned.get(source)
    if (!c) return
    for (const [type, x] of Object.entries(c.extend ?? {})) {
      const def = this.map[type]
      if (!def) continue
      const keys = new Set((x.props ?? []).map((p) => p.key))
      const pins = new Set([...(x.inputs ?? []), ...(x.outputs ?? [])].map((p) => p.id))
      def.props = def.props.filter((p) => !keys.has(p.key))
      def.inputs = def.inputs.filter((p) => !pins.has(p.id))
      def.outputs = def.outputs.filter((p) => !pins.has(p.id))
    }
    const gone = new Set((c.nodes ?? []).map((d) => d.type))
    for (let i = this.defs.length - 1; i >= 0; i--) if (gone.has(this.defs[i].type)) this.defs.splice(i, 1)
    for (const t of gone) {
      delete this.map[t]
      this.owner.delete(`node:${t}`)
    }
    for (const id of Object.keys(c.categories ?? {})) {
      delete this.categories[id]
      this.owner.delete(`category:${id}`)
    }
    for (const id of Object.keys(c.pinTypes ?? {})) {
      delete this.pinColors[id]
      this.owner.delete(`pin:${id}`)
    }
    this.owned.delete(source)
    this.changed()
  }

  /** The registered sources ("core" first). */
  sources(): string[] {
    return [...this.owned.keys()]
  }

  /** Which source defines a node type. */
  sourceOf(type: string): string | undefined {
    return this.owner.get(`node:${type}`)
  }

  /** Category ids in library order. */
  categoryOrder(): string[] {
    return Object.entries(this.categories)
      .sort(([a, x], [b, y]) => x.order - y.order || a.localeCompare(b))
      .map(([id]) => id)
  }

  /** Wire colour of a pin type (gray when unknown). */
  pinColor(type: string): string {
    return this.pinColors[type] ?? this.pinColors.any ?? '#9ca3af'
  }

  /** Dot colour of a category (gray when unknown). */
  categoryColor(id: string): string {
    return this.categories[id]?.color ?? '#71717a'
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.version

  private changed(): void {
    this.version++
    for (const fn of [...this.listeners]) fn()
  }
}

export const registry = new Registry()
