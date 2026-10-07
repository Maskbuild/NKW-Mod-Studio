/**
 * A tiny expression language for extensions: `showIf` of node properties, `when` conditions, validation
 * rules, computed mapping fields and template conditions. It cannot loop, define functions or reach
 * anything outside the values it is given: names resolve in the given scope only, only own properties are
 * readable, and only whitelisted functions can be called.
 *
 *   d.input == 'hold' || d.input == 'stand'
 *   mc >= '1.20.1' && loader != 'forge'
 *   clamp(round(prop.seconds * 20), 1, 2400)
 *   prop.blocks.length > 0 ? 'many' : 'none'
 */

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos: number
  ) {
    super(`${message} (at ${pos})`)
  }
}

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'name'; name: string }
  | { t: 'member'; obj: Expr; prop: string }
  | { t: 'index'; obj: Expr; index: Expr }
  | { t: 'call'; fn: string; args: Expr[] }
  | { t: 'array'; items: Expr[] }
  | { t: 'not'; x: Expr }
  | { t: 'neg'; x: Expr }
  | { t: 'bin'; op: string; a: Expr; b: Expr }
  | { t: 'cond'; test: Expr; a: Expr; b: Expr }

const MAX_SOURCE = 2000
const MAX_NODES = 400
const MAX_DEPTH = 40

type Tok = { k: 'num' | 'str' | 'id' | 'op' | 'end'; v: string; pos: number }

function lex(src: string): Tok[] {
  if (src.length > MAX_SOURCE) throw new ExprError('Expression is too long', 0)
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const pos = i
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!
      out.push({ k: 'num', v: m[0], pos })
      i += m[0].length
    } else if (c === '"' || c === "'") {
      let s = ''
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1]
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n
          i += 2
        } else s += src[i++]
      }
      if (src[i] !== c) throw new ExprError('Unclosed string', pos)
      i++
      out.push({ k: 'str', v: s, pos })
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!
      out.push({ k: 'id', v: m[0], pos })
      i += m[0].length
    } else {
      const two = src.slice(i, i + 2)
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        out.push({ k: 'op', v: two, pos })
        i += 2
      } else if ('+-*/%<>!?:.,()[]'.includes(c)) {
        out.push({ k: 'op', v: c, pos })
        i++
      } else throw new ExprError(`Unexpected "${c}"`, pos)
    }
  }
  out.push({ k: 'end', v: '', pos: src.length })
  return out
}

class Parser {
  private i = 0
  private nodes = 0
  constructor(private readonly toks: Tok[]) {}

  parse(): Expr {
    const e = this.ternary(0)
    if (this.peek().k !== 'end') throw new ExprError(`Unexpected "${this.peek().v}"`, this.peek().pos)
    return e
  }
  private peek = () => this.toks[this.i]
  private next = () => this.toks[this.i++]
  private isOp(v: string) {
    const t = this.peek()
    return t.k === 'op' && t.v === v
  }
  private eat(v: string) {
    if (!this.isOp(v)) throw new ExprError(`Expected "${v}"`, this.peek().pos)
    this.i++
  }
  private mk<T extends Expr>(e: T, depth: number): T {
    if (++this.nodes > MAX_NODES) throw new ExprError('Expression is too complex', this.peek().pos)
    if (depth > MAX_DEPTH) throw new ExprError('Expression is nested too deeply', this.peek().pos)
    return e
  }

  private ternary(d: number): Expr {
    const test = this.binary(0, d + 1)
    if (!this.isOp('?')) return test
    this.i++
    const a = this.ternary(d + 1)
    this.eat(':')
    const b = this.ternary(d + 1)
    return this.mk({ t: 'cond', test, a, b }, d)
  }

  private static LEVELS: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]

  private binary(level: number, d: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary(d)
    let a = this.binary(level + 1, d)
    for (;;) {
      const t = this.peek()
      if (t.k !== 'op' || !Parser.LEVELS[level].includes(t.v)) return a
      this.i++
      const b = this.binary(level + 1, d)
      a = this.mk({ t: 'bin', op: t.v, a, b }, d)
    }
  }

  private unary(d: number): Expr {
    if (this.isOp('!')) {
      this.i++
      return this.mk({ t: 'not', x: this.unary(d + 1) }, d)
    }
    if (this.isOp('-')) {
      this.i++
      return this.mk({ t: 'neg', x: this.unary(d + 1) }, d)
    }
    return this.postfix(d)
  }

  private postfix(d: number): Expr {
    let e = this.primary(d)
    for (;;) {
      if (this.isOp('.')) {
        this.i++
        const t = this.next()
        if (t.k !== 'id') throw new ExprError('Expected a property name', t.pos)
        e = this.mk({ t: 'member', obj: e, prop: t.v }, d)
      } else if (this.isOp('[')) {
        this.i++
        const index = this.ternary(d + 1)
        this.eat(']')
        e = this.mk({ t: 'index', obj: e, index }, d)
      } else return e
    }
  }

  private primary(d: number): Expr {
    const t = this.next()
    if (t.k === 'num') return this.mk({ t: 'num', v: Number(t.v) }, d)
    if (t.k === 'str') return this.mk({ t: 'str', v: t.v }, d)
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') return this.mk({ t: 'bool', v: t.v === 'true' }, d)
      if (t.v === 'null') return this.mk({ t: 'null' }, d)
      if (this.isOp('(')) {
        this.i++
        const args: Expr[] = []
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.ternary(d + 1))
            if (this.isOp(',')) this.i++
            else break
          }
        }
        this.eat(')')
        return this.mk({ t: 'call', fn: t.v, args }, d)
      }
      return this.mk({ t: 'name', name: t.v }, d)
    }
    if (t.k === 'op' && t.v === '(') {
      const e = this.ternary(d + 1)
      this.eat(')')
      return e
    }
    if (t.k === 'op' && t.v === '[') {
      const items: Expr[] = []
      if (!this.isOp(']')) {
        for (;;) {
          items.push(this.ternary(d + 1))
          if (this.isOp(',')) this.i++
          else break
        }
      }
      this.eat(']')
      return this.mk({ t: 'array', items }, d)
    }
    throw new ExprError(t.k === 'end' ? 'Unexpected end of expression' : `Unexpected "${t.v}"`, t.pos)
  }
}

export function parseExpr(src: string): Expr {
  return new Parser(lex(src)).parse()
}

export type ExprFn = (...args: unknown[]) => unknown

export interface ExprEnv {
  /** names an expression can read */
  scope: Record<string, unknown>
  /** functions an expression can call, by name */
  fns?: Record<string, ExprFn>
}

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

function read(obj: unknown, key: string | number): unknown {
  if (obj === null || obj === undefined) return undefined
  if (typeof key === 'string' && BAD_KEYS.has(key)) return undefined
  if (typeof obj === 'string') return key === 'length' ? obj.length : undefined
  if (Array.isArray(obj)) return key === 'length' ? obj.length : typeof key === 'number' || /^\d+$/.test(String(key)) ? obj[Number(key)] : undefined
  if (typeof obj === 'object') return hasOwn(obj, String(key)) ? (obj as Record<string, unknown>)[String(key)] : undefined
  return undefined
}

const VERSION = /^\d+(\.\d+)*$/
/** Compares two values; strings that look like versions ("1.20.1") compare number by number. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string' && VERSION.test(a) && VERSION.test(b)) {
    const x = a.split('.').map(Number)
    const y = b.split('.').map(Number)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0)
      if (d) return d
    }
    return 0
  }
  const x = a as number
  const y = b as number
  return x < y ? -1 : x > y ? 1 : 0
}

const nullish = (v: unknown) => v === null || v === undefined
export function equals(a: unknown, b: unknown): boolean {
  if (nullish(a) || nullish(b)) return nullish(a) && nullish(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]))
  return a === b
}

export function truthy(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v
}

export function evalExpr(e: Expr, env: ExprEnv): unknown {
  switch (e.t) {
    case 'num':
    case 'str':
    case 'bool':
      return e.v
    case 'null':
      return null
    case 'name':
      return hasOwn(env.scope, e.name) ? env.scope[e.name] : undefined
    case 'member':
      return read(evalExpr(e.obj, env), e.prop)
    case 'index': {
      const k = evalExpr(e.index, env)
      return typeof k === 'string' || typeof k === 'number' ? read(evalExpr(e.obj, env), k) : undefined
    }
    case 'array':
      return e.items.map((x) => evalExpr(x, env))
    case 'call': {
      const fn = env.fns && hasOwn(env.fns, e.fn) ? env.fns[e.fn] : MATH_FNS[e.fn]
      if (!fn) throw new ExprError(`Unknown function "${e.fn}"`, 0)
      return fn(...e.args.map((x) => evalExpr(x, env)))
    }
    case 'not':
      return !truthy(evalExpr(e.x, env))
    case 'neg':
      return -Number(evalExpr(e.x, env))
    case 'cond':
      return truthy(evalExpr(e.test, env)) ? evalExpr(e.a, env) : evalExpr(e.b, env)
    case 'bin': {
      if (e.op === '&&') {
        const a = evalExpr(e.a, env)
        return truthy(a) ? evalExpr(e.b, env) : a
      }
      if (e.op === '||') {
        const a = evalExpr(e.a, env)
        return truthy(a) ? a : evalExpr(e.b, env)
      }
      const a = evalExpr(e.a, env)
      const b = evalExpr(e.b, env)
      switch (e.op) {
        case '==':
          return equals(a, b)
        case '!=':
          return !equals(a, b)
        case '<':
          return !nullish(a) && !nullish(b) && compare(a, b) < 0
        case '<=':
          return !nullish(a) && !nullish(b) && compare(a, b) <= 0
        case '>':
          return !nullish(a) && !nullish(b) && compare(a, b) > 0
        case '>=':
          return !nullish(a) && !nullish(b) && compare(a, b) >= 0
        case '+':
          return typeof a === 'string' || typeof b === 'string' ? `${a ?? ''}${b ?? ''}` : Number(a) + Number(b)
        case '-':
          return Number(a) - Number(b)
        case '*':
          return Number(a) * Number(b)
        case '/':
          return Number(a) / Number(b)
        default:
          return Number(a) % Number(b)
      }
    }
  }
}

/** Functions every expression can call (pure maths and text helpers). */
export const MATH_FNS: Record<string, ExprFn> = {
  round: (x) => Math.round(Number(x)),
  floor: (x) => Math.floor(Number(x)),
  ceil: (x) => Math.ceil(Number(x)),
  abs: (x) => Math.abs(Number(x)),
  min: (...a) => Math.min(...a.map(Number)),
  max: (...a) => Math.max(...a.map(Number)),
  clamp: (x, lo, hi) => Math.min(Number(hi), Math.max(Number(lo), Number(x))),
  len: (x) => (typeof x === 'string' || Array.isArray(x) ? x.length : 0),
  lower: (x) => String(x ?? '').toLowerCase(),
  upper: (x) => String(x ?? '').toUpperCase(),
  trim: (x) => String(x ?? '').trim(),
  startsWith: (x, p) => String(x ?? '').startsWith(String(p)),
  endsWith: (x, p) => String(x ?? '').endsWith(String(p)),
  contains: (x, p) => (Array.isArray(x) ? x.some((v) => equals(v, p)) : String(x ?? '').includes(String(p))),
  isNull: (x) => nullish(x)
}

/** Names an expression reads from the scope (the first part of every dotted path), for validation. */
export function exprNames(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case 'name':
      out.add(e.name)
      break
    case 'member':
      exprNames(e.obj, out)
      break
    case 'index':
      exprNames(e.obj, out)
      exprNames(e.index, out)
      break
    case 'call':
      for (const a of e.args) exprNames(a, out)
      break
    case 'array':
      for (const a of e.items) exprNames(a, out)
      break
    case 'not':
    case 'neg':
      exprNames(e.x, out)
      break
    case 'bin':
      exprNames(e.a, out)
      exprNames(e.b, out)
      break
    case 'cond':
      exprNames(e.test, out)
      exprNames(e.a, out)
      exprNames(e.b, out)
      break
  }
  return out
}

/** Function names an expression calls, for validation. */
export function exprCalls(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case 'call':
      out.add(e.fn)
      for (const a of e.args) exprCalls(a, out)
      break
    case 'member':
      exprCalls(e.obj, out)
      break
    case 'index':
      exprCalls(e.obj, out)
      exprCalls(e.index, out)
      break
    case 'array':
      for (const a of e.items) exprCalls(a, out)
      break
    case 'not':
    case 'neg':
      exprCalls(e.x, out)
      break
    case 'bin':
      exprCalls(e.a, out)
      exprCalls(e.b, out)
      break
    case 'cond':
      exprCalls(e.test, out)
      exprCalls(e.a, out)
      exprCalls(e.b, out)
      break
  }
  return out
}

/** Parses once, evaluates many times. */
export function compileExpr(src: string): (env: ExprEnv) => unknown {
  const e = parseExpr(src)
  return (env) => evalExpr(e, env)
}
