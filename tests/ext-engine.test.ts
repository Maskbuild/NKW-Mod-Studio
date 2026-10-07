import { describe, expect, it } from 'vitest'
import { ExprError, compileExpr, equals, evalExpr, exprCalls, exprNames, parseExpr } from '../src/core/ext/expr'
import { FILTERS, TEMPLATE_LIMITS, TemplateError, eraMatches, javaFloat, parseEra, parseTemplate, renderTemplate, templateInfo } from '../src/core/ext/tpl'

const ev = (src: string, scope: Record<string, unknown> = {}, fns: Record<string, (...a: unknown[]) => unknown> = {}) =>
  evalExpr(parseExpr(src), { scope, fns })

describe('extension expressions', () => {
  it('does arithmetic, comparisons, text, lists and conditions', () => {
    expect(ev('1 + 2 * 3')).toBe(7)
    expect(ev('(1 + 2) * 3')).toBe(9)
    expect(ev('10 % 4 - -1')).toBe(3)
    expect(ev("'a' + 'b' + 1")).toBe('ab1')
    expect(ev("d.input == 'hold' || d.input == 'stand'", { d: { input: 'stand' } })).toBe(true)
    expect(ev('!(x > 2) && y', { x: 1, y: 'yes' })).toBe('yes')
    expect(ev("n > 0 ? 'many' : 'none'", { n: 3 })).toBe('many')
    expect(ev('xs[1] + xs.length', { xs: [10, 20, 30] })).toBe(23)
    expect(ev('[1, 2, 3].length')).toBe(3)
    expect(ev('"a\\"b"')).toBe('a"b')
  })

  it('compares Minecraft versions number by number and treats missing values as no match', () => {
    expect(ev("mc >= '1.20.1'", { mc: '1.21' })).toBe(true)
    expect(ev("mc >= '1.20.1'", { mc: '1.9.4' })).toBe(false)
    expect(ev("mc < '1.20'", { mc: '1.19.2' })).toBe(true)
    expect(ev("mc == '1.20.1'", { mc: '1.20.1' })).toBe(true)
    expect(ev('x > 1', {})).toBe(false)
    expect(ev('x == null', {})).toBe(true)
    expect(equals([1, 'a'], [1, 'a'])).toBe(true)
  })

  it('calls only maths helpers and the functions it is given', () => {
    expect(ev('clamp(round(1.6 * 20), 1, 24)')).toBe(24)
    expect(ev('max(1, 5, 3) + min(4, 2) + abs(-2) + floor(1.9) + ceil(1.1)')).toBe(5 + 2 + 2 + 1 + 2)
    expect(ev("upper(trim('  ab ')) + len('xyz')")).toBe('AB3')
    expect(ev("contains(['a', 'b'], 'b') && startsWith('farmersdelight:x', 'farmersdelight:')")).toBe(true)
    expect(ev("any('farmersdelight:')", {}, { any: (p) => p === 'farmersdelight:' })).toBe(true)
    expect(() => ev('eval("1")')).toThrow(/Unknown function "eval"/)
    expect(() => ev('process.exit()')).toThrow()
  })

  it('cannot reach anything outside its scope', () => {
    const scope = { o: { a: 1 }, s: 'text' }
    expect(ev('o.constructor', scope)).toBeUndefined()
    expect(ev('o.__proto__', scope)).toBeUndefined()
    expect(ev("o['constructor']", scope)).toBeUndefined()
    expect(ev('o.toString', scope)).toBeUndefined()
    expect(ev('s.length', scope)).toBe(4)
    expect(ev('s.toUpperCase', scope)).toBeUndefined()
    expect(ev('globalThis', scope)).toBeUndefined()
    expect(ev('constructor', scope)).toBeUndefined()
  })

  it('reports syntax errors with a position and refuses huge input', () => {
    expect(() => parseExpr('1 +')).toThrow(ExprError)
    expect(() => parseExpr("'open")).toThrow(/Unclosed string/)
    expect(() => parseExpr('a b')).toThrow(/Unexpected "b"/)
    expect(() => parseExpr('a # b')).toThrow(/Unexpected "#"/)
    expect(() => parseExpr('x'.repeat(3000))).toThrow(/too long/)
    expect(() => parseExpr('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/nested too deeply/)
    expect(() => parseExpr('1+'.repeat(500) + '1')).toThrow(/too complex/)
  })

  it('lists the names and functions an expression uses', () => {
    const e = parseExpr("a.b > clamp(c, 1, 2) && any('x')")
    expect([...exprNames(e)].sort()).toEqual(['a', 'c'])
    expect([...exprCalls(e)].sort()).toEqual(['any', 'clamp'])
    expect(compileExpr('x * 2')({ scope: { x: 4 } })).toBe(8)
  })
})

const render = (src: string, scope: Record<string, unknown> = {}, extra: Partial<Parameters<typeof renderTemplate>[1]> = {}) =>
  renderTemplate(parseTemplate(src, 't.tpl'), { scope: { mc: '1.20.1', ...scope }, ...extra })

describe('NKW-T templates', () => {
  it('writes values through filters', () => {
    expect(render('hello {{ name }}!', { name: 'ruby' })).toBe('hello ruby!')
    expect(render('{{ id | constant }} {{ id | pascal }} {{ id | camel }}', { id: 'ruby_ore' })).toBe('RUBY_ORE RubyOre rubyOre')
    expect(render('{{ s | quote }} {{ s | javaStr }}', { s: 'say "hi"\nnow\\' })).toBe('"say \\"hi\\"\\nnow\\\\" say \\"hi\\"\\nnow\\\\')
    expect(render('{{ x | float }} {{ y | float }} {{ z | int }}', { x: 2, y: 0.25, z: 2.6 })).toBe('2.0F 0.25F 3')
    expect(render('{{ list | join(", ") }}|{{ list | json }}', { list: ['a', 'b'] })).toBe('a, b|["a","b"]')
    expect(render('{{ missing | default("none") }}|{{ n | default(5) }}', { n: 0 })).toBe('none|0')
    expect(render('{{ a }}{{ "{{" }}', { a: 1 })).toBe('1{{')
    expect(render('{{ a || b }}', { a: '', b: 'fallback' })).toBe('fallback')
    expect(javaFloat(1.5)).toBe('1.5F')
    expect(FILTERS.indent('a\nb', 4)).toBe('a\n    b')
  })

  it('fails loudly on missing values, lists, unknown filters and helpers', () => {
    expect(() => render('{{ nope }}')).toThrow(/t\.tpl:1: Value is not defined/)
    expect(() => render('{{ xs }}', { xs: [1] })).toThrow(/list or object/)
    expect(() => render('{{ x | shout }}', { x: 1 })).toThrow(/Unknown filter "shout"/)
    expect(() => render('{{ evil() }}')).toThrow(/Unknown function "evil"/)
    expect(render('{{ rl("a:b") }}', {}, { fns: { rl: (v) => `new RL("${String(v)}")` } })).toBe('new RL("a:b")')
  })

  it('chooses between branches and repeats over lists', () => {
    const src = '{{#if n > 2}}big{{#elif n > 0}}small{{#else}}none{{/if}}'
    expect([3, 1, 0].map((n) => render(src, { n }))).toEqual(['big', 'small', 'none'])
    expect(render('{{#each xs as x, i}}{{ i }}={{ x }}{{#if !loop.last}},{{/if}}{{/each}}', { xs: ['a', 'b', 'c'] })).toBe('0=a,1=b,2=c')
    expect(render('{{#each xs as x}}{{ x }}{{#else}}empty{{/each}}', { xs: [] })).toBe('empty')
    expect(render('{{#each xs as x}}{{#each x as y}}{{ y }}{{/each}};{{/each}}', { xs: [[1, 2], [3]] })).toBe('12;3;')
    expect(
      render('{{#each rows as r}}{{ r.name | upper }}:{{ r.v }} {{/each}}', {
        rows: [
          { name: 'a', v: 1 },
          { name: 'b', v: 2 }
        ]
      })
    ).toBe('A:1 B:2 ')
    expect(() => render('{{#each x as i}}{{/each}}', { x: 5 })).toThrow(/needs a list/)
  })

  it('picks text by Minecraft version ranges', () => {
    expect(parseEra('1.16.5-1.18.2, 1.20+')).toEqual([
      { from: '1.16.5', to: '1.18.2' },
      { from: '1.20', to: null }
    ])
    expect(parseEra('nonsense')).toBeNull()
    expect(eraMatches('-1.18.2', '1.16.5')).toBe(true)
    expect(eraMatches('1.19.2+', '1.18.2')).toBe(false)
    expect(eraMatches('1.20.1', '1.20.1')).toBe(true)
    const src = '{{#era "1.16.5-1.18.2"}}old{{#else}}new{{/era}}'
    expect(render(src, { mc: '1.18.2' })).toBe('old')
    expect(render(src, { mc: '1.21.1' })).toBe('new')
    expect(() => parseTemplate('{{#era "x"}}{{/era}}')).toThrow(/Use \{\{#era/)
  })

  it('collects Java imports once, even from partials, and includes other templates', () => {
    const imports = new Set<string>()
    const partial = parseTemplate('{{#import "a.b.C"}}C{{ v }}', 'p.tpl')
    const out = render(
      '{{#import "a.b.C"}}{{#import "a.b.D"}}{{> p}}{{> p}}{{#if false}}{{#import "never.Used"}}{{/if}}',
      { v: 1 },
      { imports, partials: { p: partial } }
    )
    expect(out).toBe('C1C1')
    expect([...imports].sort()).toEqual(['a.b.C', 'a.b.D'])
    expect(() => render('{{> missing}}')).toThrow(/Unknown partial/)
    const loop = parseTemplate('{{> a}}', 'a')
    expect(() => renderTemplate(loop, { scope: {}, partials: { a: loop } })).toThrow(/too deeply/)
  })

  it('removes lines that only hold a block tag, and keeps Java braces alone', () => {
    const src = ['class A {', '    {{#if on}}', '    int x;', '    {{/if}}', '    {{#each xs as x}}', '    void {{ x }}() {}', '    {{/each}}', '}}', ''].join(
      '\n'
    )
    expect(render(src, { on: true, xs: ['a', 'b'] })).toBe('class A {\n    int x;\n    void a() {}\n    void b() {}\n}}\n')
    expect(render(src, { on: false, xs: [] })).toBe('class A {\n}}\n')
    expect(render('x {{#if a}}inline{{/if}} y', { a: true })).toBe('x inline y')
    expect(render('{{! note }}\nA')).toBe('A')
    expect(render('int[][] a = {{ "{{" }}1}, {2}};')).toBe('int[][] a = {{1}, {2}};')
  })

  it('reports template mistakes with the line', () => {
    expect(() => parseTemplate('a\n{{#if x}}\nb', 'f.tpl')).toThrow(/f\.tpl:2: \{\{#if\}\} is never closed/)
    expect(() => parseTemplate('{{/if}}')).toThrow(/does not match any open block/)
    expect(() => parseTemplate('{{#if a}}{{/each}}')).toThrow(/does not match \{\{#if\}\}/)
    expect(() => parseTemplate('{{#else}}')).toThrow(/outside a block/)
    expect(() => parseTemplate('{{#if a}}{{#else}}{{#else}}{{/if}}')).toThrow(/Two \{\{#else\}\}/)
    expect(() => parseTemplate('{{#if a}}{{#else}}{{#elif b}}{{/if}}')).toThrow(/after \{\{#else\}\}/)
    expect(() => parseTemplate('{{#each x}}{{/each}}')).toThrow(/Use \{\{#each/)
    expect(() => parseTemplate('{{#loop x}}{{/loop}}')).toThrow(/Unknown block/)
    expect(() => parseTemplate('{{ 1 +')).toThrow(/Unclosed/)
    expect(() => parseTemplate('{{ 1 + }}')).toThrow(/t.*:1:/)
    expect(() => parseTemplate('{{> ../x}}')).toThrow(/Bad partial name/)
    expect(() => parseTemplate('{{#import "a b"}}')).toThrow(/Use \{\{#import/)
    expect(() => parseTemplate('{{ x | }}')).toThrow()
  })

  it('stops runaway templates: size, nesting, loop rounds, output', () => {
    expect(() => parseTemplate('x'.repeat(TEMPLATE_LIMITS.source + 1))).toThrow(/too large/)
    expect(() => parseTemplate('{{#if a}}'.repeat(30) + '{{/if}}'.repeat(30))).toThrow(/nested too deeply/)
    const big = Array.from({ length: 400 }, (_, i) => i)
    expect(() => render('{{#each a as x}}{{#each a as y}}{{#each a as z}}.{{/each}}{{/each}}{{/each}}', { a: big })).toThrow(/Too many loop rounds/)
    expect(() => render('{{#each a as x}}{{ s }}{{/each}}', { a: big, s: 'x'.repeat(10000) })).toThrow(/Output is too large/)
  })

  it('tells which names, helpers, filters, partials and imports a template uses', () => {
    const info = templateInfo(
      parseTemplate(
        '{{#import "a.B"}}{{#each ir.items as it}}{{ it.id | upper }}{{ rl(modid) }}{{/each}}{{#if profile.stackId}}{{> inc}}{{/if}}{{ other | default(zzz) }}',
        'i.tpl'
      )
    )
    expect([...info.names].sort()).toEqual(['ir', 'modid', 'other', 'profile', 'zzz'])
    expect([...info.calls]).toEqual(['rl'])
    expect([...info.filters].sort()).toEqual(['default', 'upper'])
    expect([...info.partials]).toEqual(['inc'])
    expect([...info.imports]).toEqual(['a.B'])
  })

  it('has the template error type with file and line', () => {
    try {
      parseTemplate('\n\n{{ x | nope( }}', 'z.tpl')
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateError)
      expect((e as TemplateError).file).toBe('z.tpl')
      expect((e as TemplateError).line).toBe(3)
      return
    }
    throw new Error('should have thrown')
  })
})
