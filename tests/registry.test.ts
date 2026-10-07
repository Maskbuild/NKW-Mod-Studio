import { afterEach, describe, expect, it } from 'vitest'
import { registry } from '../src/core/ext/registry'
import { NODE_DEFS, NODE_DEF_MAP, PIN_COLORS, canConnect, type NodeDef } from '../src/core/nodes/defs'

const def = (type: string, category = 'item', inputType = 'item'): NodeDef => ({
  type,
  category,
  title: { en: type, th: type },
  description: { en: '', th: '' },
  icon: '★',
  inputs: [{ id: 'in', label: { en: 'in', th: 'เข้า' }, type: inputType }],
  outputs: [],
  props: []
})

afterEach(() => {
  registry.unregister('test.a')
  registry.unregister('test.b')
})

describe('node registry', () => {
  it('holds the app nodes as source "core", shared with the old exports', () => {
    expect(registry.sources()[0]).toBe('core')
    expect(NODE_DEFS).toBe(registry.defs)
    expect(NODE_DEF_MAP).toBe(registry.map)
    expect(PIN_COLORS).toBe(registry.pinColors)
    expect(NODE_DEF_MAP.item.category).toBe('item')
    expect(registry.sourceOf('item')).toBe('core')
    expect(registry.categoryOrder().slice(0, 3)).toEqual(['item', 'block', 'farm'])
  })

  it('adds and removes nodes, categories and pin types of an extension in place', () => {
    const before = registry.defs.length
    const seen: number[] = []
    const off = registry.subscribe(() => seen.push(registry.version))
    registry.register('test.a', {
      nodes: [def('extNode', 'extcat', 'extpin')],
      categories: { extcat: { label: { en: 'Ext', th: 'ส่วนเสริม' }, color: '#112233', order: 50 } },
      pinTypes: { extpin: '#445566' }
    })
    expect(registry.defs.length).toBe(before + 1)
    expect(NODE_DEF_MAP.extNode.category).toBe('extcat')
    expect(registry.sourceOf('extNode')).toBe('test.a')
    expect(PIN_COLORS.extpin).toBe('#445566')
    expect(registry.pinColor('extpin')).toBe('#445566')
    expect(registry.categoryColor('extcat')).toBe('#112233')
    expect(registry.categoryOrder().at(-1)).toBe('extcat')
    expect(canConnect('extpin', 'extpin')).toBe(true)
    expect(canConnect('extpin', 'item')).toBe(false)
    registry.unregister('test.a')
    expect(registry.defs.length).toBe(before)
    expect(NODE_DEF_MAP.extNode).toBeUndefined()
    expect(PIN_COLORS.extpin).toBeUndefined()
    expect(registry.categories.extcat).toBeUndefined()
    // unknown things fall back to gray; two changes were announced
    expect(registry.pinColor('extpin')).toBe(PIN_COLORS.any)
    expect(registry.categoryColor('extcat')).toBe('#71717a')
    expect(seen.length).toBe(2)
    expect(seen[1]).toBeGreaterThan(seen[0])
    off()
  })

  it('refuses clashes and bad ids without changing anything', () => {
    registry.register('test.a', { nodes: [def('shared')] })
    const count = registry.defs.length
    expect(() => registry.register('test.b', { nodes: [def('shared')] })).toThrow(/already defined by "test.a"/)
    expect(() => registry.register('test.b', { nodes: [def('item')] })).toThrow(/by "core"/)
    expect(() => registry.register('test.b', { nodes: [def('dup'), def('dup')] })).toThrow(/already defined/)
    expect(() => registry.register('test.b', { nodes: [def('bad type!')] })).toThrow(/Invalid node type/)
    expect(() => registry.register('test.b', { categories: { item: { label: { en: 'x', th: 'x' }, color: '#000000', order: 1 } } })).toThrow(/Category "item"/)
    expect(() => registry.register('test.b', { categories: { ok: { label: { en: 'x', th: 'x' }, color: 'red', order: 1 } } })).toThrow(/colour/)
    expect(() => registry.register('test.b', { pinTypes: { item: '#000000' } })).toThrow(/Pin type "item"/)
    expect(() => registry.register('test.a', {})).toThrow(/already registered/)
    expect(registry.defs.length).toBe(count)
    expect(registry.sources()).toEqual(['core', 'test.a'])
    // removing a source that was never added does nothing
    registry.unregister('test.b')
    expect(registry.sources()).toEqual(['core', 'test.a'])
  })
})
