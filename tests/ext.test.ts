import { afterEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { extHost } from '../src/core/ext/host'
import { loadExtension, type FileMap } from '../src/core/ext/manifest'
import { registry } from '../src/core/ext/registry'
import { newProject, type Project } from '../src/core/project'

const L = (en: string) => ({ en, th: en })

const manifest = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  id: 'demo-ext',
  name: L('Demo'),
  description: L('Demo extension'),
  version: '1.0.0',
  categories: { demo: { label: L('Demo'), color: '#112233', order: 900 } },
  pinTypes: { democfg: '#445566' },
  nodes: ['nodes/box.json', 'nodes/use.json'],
  derive: [{ slot: 'big', from: 'demo-ext.boxes', where: 'item.size > 5', value: { id: { item: 'id' }, double: { computed: 'item.size * 2' } } }],
  ...over
})

const box = {
  type: 'demoBox',
  category: 'demo',
  title: L('Box'),
  description: L('A box'),
  icon: 'box',
  outputs: [{ id: 'out', label: L('Out'), type: 'democfg' }],
  props: [
    { key: 'id', label: L('Id'), kind: 'id', default: 'box' },
    { key: 'size', label: L('Size'), kind: 'float', default: 3 },
    {
      key: 'mode',
      label: L('Mode'),
      kind: 'select',
      default: 'a',
      options: [
        { value: 'a', label: L('A') },
        { value: 'b', label: L('B') }
      ]
    },
    { key: 'extra', label: L('Extra'), kind: 'bool', default: false },
    { key: 'note', label: L('Note'), kind: 'text', default: '', showIf: 'data.extra' }
  ],
  compile: {
    emit: {
      slot: 'boxes',
      value: {
        id: { prop: 'id' },
        size: { prop: 'size', as: 'number', min: 1, max: 10 },
        ticks: { prop: 'size', as: 'int', min: 1, max: 10, mul: 20 },
        mode: { prop: 'mode', as: 'string', values: ['a', 'b'], default: 'a' }
      }
    },
    validate: [
      { unique: 'id', diag: 'error', msg: L('Duplicate box {prop.id}') },
      { if: 'prop.size > 8', diag: 'warning', msg: L('Box {prop.id} is huge') }
    ]
  }
}

const use = {
  type: 'demoUse',
  category: 'demo',
  title: L('Use'),
  description: L('Uses a box'),
  icon: 'box',
  inputs: [{ id: 'cfg', label: L('Config'), type: 'democfg' }],
  compile: { emit: { slot: 'uses', value: { box: { input: 'cfg', required: true } } } }
}

const files = (m: unknown = manifest(), extra: Record<string, unknown> = {}): FileMap =>
  new Map<string, string>([
    ['nkw-extension.json', JSON.stringify(m)],
    ['nodes/box.json', JSON.stringify(box)],
    ['nodes/use.json', JSON.stringify(use)],
    ...Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string])
  ])

const project = (nodes: Project['graph']['nodes'], edges: Project['graph']['edges'] = []): Project => {
  const p = newProject({ name: 'T', modId: 'tmod', version: '1.0.0', authors: 'a', description: '', license: 'MIT', homepage: '', issues: '', credits: [] }, [
    { loader: 'fabric', mc: '1.21.1' }
  ])
  p.graph = { nodes, edges }
  return p
}
const nd = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data })

afterEach(() => extHost.clear())

const load = (f: FileMap) => {
  const r = loadExtension(f)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.ext
}
const errorsOf = (f: FileMap) => {
  const r = loadExtension(f)
  if (r.ok) throw new Error('expected errors')
  return r.errors.join('\n')
}

describe('manifest loader', () => {
  it('loads a valid extension', () => {
    const e = load(files())
    expect(e.nodes.map((n) => n.type)).toEqual(['demoBox', 'demoUse'])
    expect(e.contribution.pinTypes).toEqual({ democfg: '#445566' })
  })

  it('rejects unknown manifest fields and bad ids', () => {
    expect(errorsOf(files(manifest({ evil: 1 })))).toMatch(/nkw-extension\.json/)
    expect(errorsOf(files(manifest({ id: 'X' })))).toMatch(/id/)
    expect(errorsOf(files(manifest({ version: 'one' })))).toMatch(/Version/)
  })

  it('rejects code and unsafe paths', () => {
    expect(errorsOf(files(manifest(), { 'x/run.js': 'alert(1)' }))).toMatch(/not allowed/)
    expect(errorsOf(files(manifest(), { 'a.jar': 'x' }))).toMatch(/not allowed/)
    expect(errorsOf(files(manifest({ nodes: ['../x.json'] })))).toMatch(/nodes/)
  })

  it('reports broken nodes: duplicate type, bad category, bad pin type, unknown prop', () => {
    const bad = (patch: Record<string, unknown>) => errorsOf(files(manifest(), { 'nodes/box.json': { ...box, ...patch } }))
    expect(bad({ category: 'nope' })).toMatch(/unknown category/)
    expect(bad({ outputs: [{ id: 'o', label: L('o'), type: 'nope' }] })).toMatch(/unknown type/)
    expect(bad({ compile: { emit: { slot: 's', value: { a: { prop: 'missing' } } } } })).toMatch(/unknown property/)
    expect(bad({ type: 'demoUse' })).toMatch(/defined twice/)
    expect(bad({ props: [{ ...box.props[2], options: undefined }] })).toMatch(/needs options/)
    expect(bad({ compile: { validate: [{ if: 'foo.bar > 1', diag: 'error', msg: L('x') }] } })).toMatch(/Unknown name/)
    expect(bad({ compile: { validate: [{ if: 'evil(1)', diag: 'error', msg: L('x') }] } })).toMatch(/Unknown function/)
  })

  it('checks templates in generate', () => {
    const gen = (template: string, src: string) =>
      files(manifest({ generate: [{ id: 'g', emit: [{ kind: 'java', class: 'X', template }] }] }), { [template]: src })
    expect(load(gen('t/x.tpl', 'class X { {{ modId }} }')).templates['t/x.tpl']).toBeTruthy()
    expect(errorsOf(gen('t/x.tpl', '{{ secret }}'))).toMatch(/unknown name "secret"/)
    expect(errorsOf(gen('t/x.tpl', '{{#each'))).toMatch(/x\.tpl/)
    expect(errorsOf(files(manifest({ generate: [{ id: 'g', emit: [{ kind: 'java', class: 'X', template: 'gone.tpl' }] }] })))).toMatch(/not found/)
  })

  it('expands pin counts', () => {
    const e = load(
      files(manifest(), {
        'nodes/use.json': { ...use, inputs: [{ id: 'cfg', label: L('Config'), type: 'democfg', count: 3 }], compile: undefined }
      })
    )
    expect(e.nodes[1].inputs.map((p) => p.id)).toEqual(['cfg1', 'cfg2', 'cfg3'])
    expect(e.nodes[1].inputs[2].label.en).toBe('Config 3')
  })

  it('showIf is compiled to a safe predicate', () => {
    const note = load(files()).nodes[0].props[4]
    expect(note.showIf!({ extra: true })).toBe(true)
    expect(note.showIf!({ extra: false })).toBe(false)
  })
})

describe('extension host and registry', () => {
  it('registers and removes nodes, categories and pin types', () => {
    const e = load(files())
    extHost.enable(e)
    expect(registry.map.demoBox).toBeTruthy()
    expect(registry.categories.demo.color).toBe('#112233')
    expect(registry.pinColors.democfg).toBe('#445566')
    extHost.disable('demo-ext')
    expect(registry.map.demoBox).toBeUndefined()
    expect(registry.categories.demo).toBeUndefined()
  })

  it('refuses a clash with a core node type', () => {
    const e = load(files(manifest(), { 'nodes/box.json': { ...box, type: 'item' } }))
    expect(() => extHost.enable(e)).toThrow(/already defined/)
  })
})

describe('mapping in compile()', () => {
  const run = (nodes: Project['graph']['nodes'], edges: Project['graph']['edges'] = []) => {
    extHost.enable(load(files()))
    return compile(project(nodes, edges))
  }

  it('clamps, converts, restricts and defaults values', () => {
    const { ir } = run([nd('b', 'demoBox', { id: 'x', size: 99, mode: 'zzz' })])
    expect(ir.ext['demo-ext'].boxes).toEqual([{ nodeId: 'b', id: 'x', size: 10, ticks: 200, mode: 'a' }])
  })

  it('uses defaults for missing properties', () => {
    const { ir } = run([nd('b', 'demoBox')])
    expect(ir.ext['demo-ext'].boxes[0]).toMatchObject({ id: 'box', size: 3, ticks: 60 })
  })

  it('derives records from other records', () => {
    const { ir } = run([nd('a', 'demoBox', { id: 'a', size: 2 }), nd('b', 'demoBox', { id: 'b', size: 7 })])
    expect(ir.ext['demo-ext'].big).toEqual([{ id: 'b', double: 14 }])
  })

  it('reports validation diagnostics', () => {
    const { diagnostics } = run([nd('a', 'demoBox', { id: 'same', size: 9 }), nd('b', 'demoBox', { id: 'same', size: 1 })])
    expect(diagnostics.some((d) => d.severity === 'warning' && d.message.en === 'Box same is huge')).toBe(true)
    expect(diagnostics.some((d) => d.severity === 'error' && d.nodeId === 'b' && d.message.en === 'Duplicate box same')).toBe(true)
  })

  it('reads an input wired from another extension node, and complains when missing', () => {
    const edge = { id: 'e', source: 'b', sourceHandle: 'out', target: 'u', targetHandle: 'cfg' }
    const ok = run([nd('b', 'demoBox', { id: 'q' }), nd('u', 'demoUse')], [edge])
    expect(ok.ir.ext['demo-ext'].uses[0].box).toMatchObject({ id: 'q' })
    extHost.clear()
    const bad = run([nd('u', 'demoUse')])
    expect(bad.diagnostics.some((d) => d.severity === 'error' && /Connect something/.test(d.message.en))).toBe(true)
  })

  it('ignores extension nodes of disabled nodes and leaves nothing when the extension is off', () => {
    const { ir } = run([nd('b', 'demoBox', { disabled: true })])
    expect(ir.ext['demo-ext']).toBeUndefined()
    extHost.clear()
    const off = compile(project([nd('b', 'demoBox')]))
    expect(off.diagnostics.some((d) => d.severity === 'error' && /Unknown node type/.test(d.message.en))).toBe(true)
  })
})

describe('extension code generation', () => {
  const genFiles = (f: FileMap, mc = '1.21.1', loader: 'fabric' | 'neoforge' = 'fabric') => {
    extHost.enable(load(f))
    const target = { loader, mc }
    const { ir } = compile(project([nd('a', 'demoBox', { id: 'a', size: 2 }), nd('b', 'demoBox', { id: 'b', size: 7 })]), target)
    return generate(ir, target, { ...TOOL_VERSIONS, ...FALLBACK_DEPS[mc], gradle: '8.14.3' }, { readText: () => '' })
  }
  const withGen = (over: Record<string, unknown> = {}) =>
    files(
      manifest({
        generate: [
          { id: 'cls', emit: [{ kind: 'java', class: 'DemoBoxes', template: 't/boxes.tpl' }] },
          { id: 'each', each: 'ext.boxes', emit: [{ kind: 'file', path: 'resources/data/{{ modId }}/demo/{{ item.id }}.txt', template: 't/one.tpl' }] }
        ],
        hooks: [{ site: 'commonInit', order: 5, line: 'DemoBoxes.init();' }],
        ...over
      }),
      {
        't/boxes.tpl':
          '{{#import "java.util.List"}}\npublic final class DemoBoxes {\n    public static void init() {\n{{#each ext.boxes as item}}        // {{ item.id }} x{{ item.ticks }}\n{{/each}}    }\n}\n',
        't/const.tpl': 'x',
        't/one.tpl': 'box={{ item.id }} size={{ item.size }}\n'
      }
    )

  it('renders Java classes, per-record files and init hooks into the mod', () => {
    const out = genFiles(withGen())
    const cls = out.find((f) => f.path.endsWith('/DemoBoxes.java'))!
    expect(cls.text).toContain('import java.util.List;')
    expect(cls.text).toContain('// a x40')
    expect(cls.text).toContain('// b x140')
    expect(out.find((f) => f.path.endsWith('/demo/b.txt'))!.text).toBe('box=b size=7\n')
    const main = out.find((f) => f.path.endsWith('/NkwMod.java'))!.text!
    expect(main.indexOf('DemoBoxes.init();')).toBeGreaterThan(main.indexOf('ModTabs.init();'))
  })

  it('works on Forge-like loaders and skips targets the extension does not support', () => {
    expect(genFiles(withGen(), '1.21.1', 'neoforge').some((f) => f.path.endsWith('/DemoBoxes.java'))).toBe(true)
    extHost.clear()
    const only = withGen({ targets: { loaders: ['fabric'] } })
    expect(genFiles(only, '1.21.1', 'neoforge').some((f) => f.path.endsWith('/DemoBoxes.java'))).toBe(false)
    extHost.clear()
    expect(genFiles(withGen({ targets: { mc: '1.21.4+' } }), '1.21.1').some((f) => f.path.endsWith('/DemoBoxes.java'))).toBe(false)
  })

  it('refuses to write outside the project', () => {
    const f = withGen({ generate: [{ id: 'x', emit: [{ kind: 'file', path: '../evil.txt', template: 't/const.tpl' }] }], hooks: [] })
    expect(() => genFiles(f)).toThrow(/tried to write/)
  })
})

describe('extendNodes', () => {
  const ext = (x: Record<string, unknown>) => files(manifest({ extendNodes: [{ type: 'item', ...x }] }))
  const prop = { key: 'glowAmount', label: L('Glow'), kind: 'int', default: 2, min: 0, max: 5 }

  it('adds properties and pins to a node of the app and takes them away again', () => {
    const before = registry.map.item.props.length
    extHost.enable(
      load(
        ext({
          props: [prop],
          inputs: [{ id: 'cfg', label: L('Config'), type: 'democfg', optional: true }],
          afterProp: 'id'
        })
      )
    )
    const def = registry.map.item
    expect(def.props.findIndex((p) => p.key === 'glowAmount')).toBe(def.props.findIndex((p) => p.key === 'id') + 1)
    expect(def.inputs.some((p) => p.id === 'cfg')).toBe(true)
    extHost.disable('demo-ext')
    expect(registry.map.item.props.length).toBe(before)
    expect(registry.map.item.inputs.some((p) => p.id === 'cfg')).toBe(false)
  })

  it('rejects a clash with an existing property and unknown targets', () => {
    expect(() => extHost.enable(load(ext({ props: [{ ...prop, key: 'id' }] })))).toThrow(/already has a property/)
    extHost.clear()
    expect(() => extHost.enable(load(files(manifest({ extendNodes: [{ type: 'nope', props: [prop] }] }))))).toThrow(/no such node type/)
  })

  it('the extension reads what it added through prop sources', () => {
    const f = files(manifest({ extendNodes: [{ type: 'demoBox', props: [prop] }] }), {
      'nodes/box.json': { ...box, compile: { emit: { slot: 'boxes', value: { glow: { prop: 'glowAmount', as: 'int', default: 2 } } } } }
    })
    extHost.enable(load(f))
    const { ir } = compile(project([nd('b', 'demoBox', { glowAmount: 4 })]))
    expect(ir.ext['demo-ext'].boxes[0].glow).toBe(4)
  })
})
