import { ExprError, evalExpr, exprCalls, exprNames, parseExpr, truthy, type Expr, type ExprFn } from './expr'

/**
 * NKW-T: the template language of extensions. It writes Java, JSON, Gradle … text from the compiled mod.
 * It is not a programming language: it can read values, repeat over a finite list and choose between
 * branches, nothing else (no recursion, no assignments, no calls except whitelisted helpers).
 *
 *   {{ expr | filter | filter(arg) }}      write a value (undefined is an error unless `| default(x)`)
 *   {{#if cond}} … {{#elif cond}} … {{#else}} … {{/if}}
 *   {{#each list as item, i}} … {{#else}} (empty) … {{/each}}      loop.index / loop.first / loop.last
 *   {{#era "1.16.5-1.18.2, 1.20+"}} … {{#else}} … {{/era}}          Minecraft version ranges
 *   {{#import "net.minecraft.world.level.Level"}}                   Java import (collected, deduplicated)
 *   {{> partialName}}                                               include another template of the extension
 *   {{! a comment }}                                                nothing
 *
 * A line that holds only a block tag disappears completely. For a literal "{{" write {{ "{{" }}.
 */

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly file: string
  ) {
    super(`${file}:${line}: ${message}`)
  }
}

export type TplNode =
  | { t: 'text'; v: string }
  | { t: 'out'; expr: Expr; filters: { name: string; args: Expr[] }[]; line: number }
  | { t: 'if'; branches: { test: Expr; body: TplNode[] }[]; else: TplNode[] | null }
  | { t: 'each'; list: Expr; item: string; index: string | null; body: TplNode[]; else: TplNode[] | null; line: number }
  | { t: 'era'; spec: string; body: TplNode[]; else: TplNode[] | null }
  | { t: 'import'; fqcn: string }
  | { t: 'partial'; name: string; line: number }

export interface Template {
  name: string
  ast: TplNode[]
}

export const TEMPLATE_LIMITS = { source: 300_000, nodes: 20_000, output: 2_000_000, loops: 100_000, depth: 8, nesting: 24 }

interface Tag {
  kind: 'tag'
  raw: string
  line: number
  block: boolean
}
interface Text {
  kind: 'text'
  v: string
}

/** Splits the source into text and `{{ … }}` tags. */
function tokenize(src: string, name: string): (Tag | Text)[] {
  const out: (Tag | Text)[] = []
  let i = 0
  const newlines: number[] = []
  for (let k = src.indexOf('\n'); k >= 0; k = src.indexOf('\n', k + 1)) newlines.push(k)
  /** 1-based line of a source offset */
  const lineOf = (pos: number) => {
    let lo = 0
    let hi = newlines.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (newlines[mid] < pos) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
  while (i < src.length) {
    const open = src.indexOf('{{', i)
    if (open < 0) {
      out.push({ kind: 'text', v: src.slice(i) })
      break
    }
    if (open > i) out.push({ kind: 'text', v: src.slice(i, open) })
    const line = lineOf(open)
    // the closing "}}" ends the tag, but not inside a string literal
    let j = open + 2
    let quote = ''
    let close = -1
    while (j < src.length) {
      const c = src[j]
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '}' && src[j + 1] === '}') {
        close = j
        break
      }
      j++
    }
    if (close < 0) throw new TemplateError('Unclosed "{{"', line, name)
    const raw = src.slice(open + 2, close).trim()
    const block = /^(#|\/|!)/.test(raw)
    out.push({ kind: 'tag', raw, line, block })
    i = close + 2
  }
  // a block tag alone on its line takes the whole line with it. Decided on the original text first (stripping
  // one tag's line must not hide the line start another tag needs), then applied.
  const alone: boolean[] = out.map((tk, k) => {
    if (tk.kind !== 'tag' || !tk.block) return false
    const prev = out[k - 1]
    const next = out[k + 1]
    // before the tag: only blanks back to a newline (or the start of the file)
    const startOk = k === 0 || (prev.kind === 'text' && (/\n[ \t]*$/.test(prev.v) || (k === 1 && /^[ \t]*$/.test(prev.v))))
    // after the tag: only blanks up to a newline (or the end of the file)
    const endOk = k === out.length - 1 || (next.kind === 'text' && (/^[ \t]*\r?\n/.test(next.v) || (k + 1 === out.length - 1 && /^[ \t]*$/.test(next.v))))
    return startOk && endOk
  })
  out.forEach((_tk, k) => {
    if (!alone[k]) return
    const prev = out[k - 1]
    const next = out[k + 1]
    if (prev?.kind === 'text') prev.v = prev.v.replace(/[ \t]*$/, '')
    if (next?.kind === 'text') next.v = next.v.replace(/^[ \t]*\r?\n?/, '')
  })
  return out
}

/** Splits `expr | filter(a) | filter` on single pipes (not `||`, not inside strings). */
function splitPipes(s: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      cur += c
    } else if (c === '|' && s[i + 1] === '|') {
      cur += '||'
      i++
    } else if (c === '|') {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  parts.push(cur)
  return parts.map((p) => p.trim())
}

export function parseTemplate(src: string, name = 'template'): Template {
  if (src.length > TEMPLATE_LIMITS.source) throw new TemplateError('Template is too large', 1, name)
  const toks = tokenize(src, name)
  let count = 0
  const bump = (line: number) => {
    if (++count > TEMPLATE_LIMITS.nodes) throw new TemplateError('Template has too many parts', line, name)
  }
  const expr = (s: string, line: number): Expr => {
    try {
      return parseExpr(s)
    } catch (e) {
      throw new TemplateError(e instanceof ExprError ? e.message : String(e), line, name)
    }
  }

  type Frame = { kind: 'root' | 'if' | 'each' | 'era'; node?: TplNode; body: TplNode[]; line: number }
  const root: Frame = { kind: 'root', body: [], line: 1 }
  const stack: Frame[] = [root]
  const top = () => stack[stack.length - 1]

  for (const tk of toks) {
    if (tk.kind === 'text') {
      if (tk.v) {
        bump(0)
        top().body.push({ t: 'text', v: tk.v })
      }
      continue
    }
    const { raw, line } = tk
    bump(line)
    if (raw.startsWith('!')) continue
    if (raw.startsWith('#if ') || raw === '#if') {
      if (stack.length > TEMPLATE_LIMITS.nesting) throw new TemplateError('Blocks are nested too deeply', line, name)
      const node: TplNode = { t: 'if', branches: [{ test: expr(raw.slice(3), line), body: [] }], else: null }
      top().body.push(node)
      stack.push({ kind: 'if', node, body: node.branches[0].body, line })
    } else if (raw.startsWith('#elif')) {
      const f = top()
      if (f.kind !== 'if') throw new TemplateError('{{#elif}} without {{#if}}', line, name)
      const node = f.node as Extract<TplNode, { t: 'if' }>
      if (node.else) throw new TemplateError('{{#elif}} after {{#else}}', line, name)
      const branch = { test: expr(raw.slice(5), line), body: [] as TplNode[] }
      node.branches.push(branch)
      f.body = branch.body
    } else if (raw === '#else') {
      const f = top()
      if (f.kind === 'root' || !f.node) throw new TemplateError('{{#else}} outside a block', line, name)
      const node = f.node as Extract<TplNode, { t: 'if' | 'each' | 'era' }>
      if (node.else) throw new TemplateError('Two {{#else}} in one block', line, name)
      node.else = []
      f.body = node.else
    } else if (raw.startsWith('#each ')) {
      if (stack.length > TEMPLATE_LIMITS.nesting) throw new TemplateError('Blocks are nested too deeply', line, name)
      const m = /^#each\s+(.+?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z_][A-Za-z0-9_]*))?\s*$/.exec(raw)
      if (!m) throw new TemplateError('Use {{#each list as item}} or {{#each list as item, index}}', line, name)
      const node: TplNode = { t: 'each', list: expr(m[1], line), item: m[2], index: m[3] ?? null, body: [], else: null, line }
      top().body.push(node)
      stack.push({ kind: 'each', node, body: node.body, line })
    } else if (raw.startsWith('#era')) {
      if (stack.length > TEMPLATE_LIMITS.nesting) throw new TemplateError('Blocks are nested too deeply', line, name)
      const m = /^#era\s+"([^"]*)"\s*$/.exec(raw)
      if (!m || !parseEra(m[1])) throw new TemplateError('Use {{#era "1.16.5-1.18.2, 1.20+"}}', line, name)
      const node: TplNode = { t: 'era', spec: m[1], body: [], else: null }
      top().body.push(node)
      stack.push({ kind: 'era', node, body: node.body, line })
    } else if (raw.startsWith('/')) {
      const kind = raw.slice(1).trim()
      const f = top()
      if (f.kind === 'root' || f.kind !== kind)
        throw new TemplateError(`{{/${kind}}} does not match ${f.kind === 'root' ? 'any open block' : `{{#${f.kind}}}`}`, line, name)
      stack.pop()
    } else if (raw.startsWith('#import')) {
      const m = /^#import\s+"([A-Za-z_][\w.]*)"\s*$/.exec(raw)
      if (!m) throw new TemplateError('Use {{#import "net.minecraft.world.level.Level"}}', line, name)
      top().body.push({ t: 'import', fqcn: m[1] })
    } else if (raw.startsWith('>')) {
      const pn = raw.slice(1).trim()
      if (!/^[A-Za-z0-9_./-]{1,100}$/.test(pn) || pn.includes('..')) throw new TemplateError('Bad partial name', line, name)
      top().body.push({ t: 'partial', name: pn, line })
    } else if (raw.startsWith('#')) {
      throw new TemplateError(`Unknown block "{{${raw.split(/\s/)[0]}}}"`, line, name)
    } else {
      const [head, ...fs] = splitPipes(raw)
      if (!head) throw new TemplateError('Empty {{ }}', line, name)
      const filters = fs.map((f) => {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/.exec(f)
        if (!m) throw new TemplateError(`Bad filter "${f}"`, line, name)
        const list = m[2]?.trim() ? (expr(`[${m[2]}]`, line) as Extract<Expr, { t: 'array' }>) : null
        return { name: m[1], args: list ? list.items : [] }
      })
      top().body.push({ t: 'out', expr: expr(head, line), filters, line })
    }
  }
  if (stack.length > 1) throw new TemplateError(`{{#${top().kind}}} is never closed`, top().line, name)
  return { name, ast: root.body }
}

// ───────── Minecraft version ranges ─────────

type Range = { from: string | null; to: string | null }

/** "1.16.5-1.18.2, 1.20+, -1.19.2, 1.21.1" → ranges; null when malformed. */
export function parseEra(spec: string): Range[] | null {
  const out: Range[] = []
  for (const part of spec.split(',').map((s) => s.trim())) {
    let m: RegExpExecArray | null
    if ((m = /^(\d+(?:\.\d+)+)\+$/.exec(part))) out.push({ from: m[1], to: null })
    else if ((m = /^-(\d+(?:\.\d+)+)$/.exec(part))) out.push({ from: null, to: m[1] })
    else if ((m = /^(\d+(?:\.\d+)+)-(\d+(?:\.\d+)+)$/.exec(part))) out.push({ from: m[1], to: m[2] })
    else if ((m = /^(\d+(?:\.\d+)+)$/.exec(part))) out.push({ from: m[1], to: m[1] })
    else return null
  }
  return out.length ? out : null
}

function versionCmp(a: string, b: string): number {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

export function eraMatches(spec: string, mc: string): boolean {
  const ranges = parseEra(spec)
  return !!ranges && ranges.some((r) => (!r.from || versionCmp(mc, r.from) >= 0) && (!r.to || versionCmp(mc, r.to) <= 0))
}

// ───────── filters ─────────

const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')

/** A Java float literal: 2 → 2.0F, 0.5 → 0.5F. */
export function javaFloat(n: number): string {
  const s = String(Math.round(n * 1e6) / 1e6)
  return `${/[.e]/i.test(s) ? s : `${s}.0`}F`
}

const javaEscape = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/\t/g, '\\t')
    // non-ASCII text as \uXXXX escapes, so the source reads the same whatever encoding the compiler assumes
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

export const FILTERS: Record<string, (v: unknown, ...args: unknown[]) => unknown> = {
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  pascal: (v) => pascal(String(v)),
  camel: (v) => {
    const p = pascal(String(v))
    return p ? p[0].toLowerCase() + p.slice(1) : p
  },
  /** ruby_ore → RUBY_ORE (a Java constant name) */
  constant: (v) =>
    String(v)
      .replace(/[^A-Za-z0-9]+/g, '_')
      .toUpperCase(),
  /** text for the inside of a Java string literal */
  javaStr: (v) => javaEscape(String(v)),
  /** a Java string literal, quotes included */
  quote: (v) => `"${javaEscape(String(v))}"`,
  json: (v) => JSON.stringify(v),
  int: (v) => String(Math.round(Number(v))),
  float: (v) => javaFloat(Number(v)),
  str: (v) => String(v ?? ''),
  join: (v, sep) => (Array.isArray(v) ? v.map(String).join(String(sep ?? ', ')) : String(v)),
  indent: (v, n) => String(v).replace(/\n/g, `\n${' '.repeat(Math.max(0, Math.min(40, Number(n) || 0)))}`),
  default: (v, d) => (v === null || v === undefined ? d : v)
}

// ───────── rendering ─────────

export interface RenderCtx {
  /** names the template can read (ir, ext, profile, loader, mc …) */
  scope: Record<string, unknown>
  /** helpers the template may call */
  fns?: Record<string, ExprFn>
  /** templates other templates may include */
  partials?: Record<string, Template>
  /** Java imports collected by {{#import}} (and by helpers) */
  imports?: Set<string>
}

export function renderTemplate(tpl: Template, ctx: RenderCtx): string {
  let out = ''
  let loops = 0
  const imports = ctx.imports ?? new Set<string>()

  const write = (s: string, line: number) => {
    out += s
    if (out.length > TEMPLATE_LIMITS.output) throw new TemplateError('Output is too large', line, tpl.name)
  }
  const fail = (e: unknown, line: number, name: string): never => {
    if (e instanceof TemplateError) throw e
    throw new TemplateError(e instanceof Error ? e.message : String(e), line, name)
  }

  const run = (nodes: TplNode[], scope: Record<string, unknown>, depth: number, name: string): void => {
    const env = { scope, fns: ctx.fns }
    for (const n of nodes) {
      switch (n.t) {
        case 'text':
          write(n.v, 0)
          break
        case 'out': {
          let v: unknown
          try {
            v = evalExpr(n.expr, env)
            for (const f of n.filters) {
              const fn = FILTERS[f.name]
              if (!fn) throw new Error(`Unknown filter "${f.name}"`)
              v = fn(v, ...f.args.map((a) => evalExpr(a, env)))
            }
          } catch (e) {
            fail(e, n.line, name)
          }
          if (v === null || v === undefined) fail(new Error('Value is not defined (use | default(...) when it can be missing)'), n.line, name)
          if (typeof v === 'object') fail(new Error('Value is a list or object (use | json or | join)'), n.line, name)
          write(String(v), n.line)
          break
        }
        case 'if': {
          let hit: TplNode[] | null = n.else
          for (const b of n.branches) {
            let ok = false
            try {
              ok = truthy(evalExpr(b.test, env))
            } catch (e) {
              fail(e, 0, name)
            }
            if (ok) {
              hit = b.body
              break
            }
          }
          if (hit) run(hit, scope, depth, name)
          break
        }
        case 'each': {
          let list: unknown
          try {
            list = evalExpr(n.list, env)
          } catch (e) {
            fail(e, n.line, name)
          }
          if (list !== null && list !== undefined && !Array.isArray(list)) fail(new Error('{{#each}} needs a list'), n.line, name)
          const items = (list as unknown[] | null | undefined) ?? []
          if (!items.length) {
            if (n.else) run(n.else, scope, depth, name)
            break
          }
          items.forEach((item, i) => {
            if (++loops > TEMPLATE_LIMITS.loops) fail(new Error('Too many loop rounds'), n.line, name)
            const inner: Record<string, unknown> = {
              ...scope,
              [n.item]: item,
              loop: { index: i, first: i === 0, last: i === items.length - 1 }
            }
            if (n.index) inner[n.index] = i
            run(n.body, inner, depth, name)
          })
          break
        }
        case 'era': {
          const hit = eraMatches(n.spec, String(scope.mc ?? ''))
          const body = hit ? n.body : n.else
          if (body) run(body, scope, depth, name)
          break
        }
        case 'import':
          imports.add(n.fqcn)
          break
        case 'partial': {
          const p = ctx.partials?.[n.name]
          if (!p) fail(new Error(`Unknown partial "${n.name}"`), n.line, name)
          if (depth >= TEMPLATE_LIMITS.depth) fail(new Error('Partials are included too deeply'), n.line, name)
          run(p!.ast, scope, depth + 1, p!.name)
          break
        }
      }
    }
  }
  run(tpl.ast, ctx.scope, 0, tpl.name)
  return out
}

// ───────── what a template uses (install-time validation) ─────────

export interface TemplateInfo {
  /** names read from the scope (excluding loop variables) */
  names: Set<string>
  /** functions called */
  calls: Set<string>
  filters: Set<string>
  partials: Set<string>
  imports: Set<string>
}

export function templateInfo(tpl: Template): TemplateInfo {
  const info: TemplateInfo = { names: new Set(), calls: new Set(), filters: new Set(), partials: new Set(), imports: new Set() }
  const addExpr = (e: Expr, local: Set<string>) => {
    for (const n of exprNames(e)) if (!local.has(n)) info.names.add(n)
    for (const c of exprCalls(e)) info.calls.add(c)
  }
  const walk = (nodes: TplNode[], local: Set<string>) => {
    for (const n of nodes) {
      if (n.t === 'out') {
        addExpr(n.expr, local)
        for (const f of n.filters) {
          info.filters.add(f.name)
          for (const a of f.args) addExpr(a, local)
        }
      } else if (n.t === 'if') {
        for (const b of n.branches) {
          addExpr(b.test, local)
          walk(b.body, local)
        }
        if (n.else) walk(n.else, local)
      } else if (n.t === 'each') {
        addExpr(n.list, local)
        const inner = new Set(local).add(n.item).add('loop')
        if (n.index) inner.add(n.index)
        walk(n.body, inner)
        if (n.else) walk(n.else, local)
      } else if (n.t === 'era') {
        walk(n.body, local)
        if (n.else) walk(n.else, local)
      } else if (n.t === 'import') info.imports.add(n.fqcn)
      else if (n.t === 'partial') info.partials.add(n.name)
    }
  }
  walk(tpl.ast, new Set())
  return info
}
