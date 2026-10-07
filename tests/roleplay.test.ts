import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { enableFirstParty } from '../src/core/ext/firstparty'
import { extHost } from '../src/core/ext/host'
import { registry } from '../src/core/ext/registry'
import { usedExtensions } from '../src/core/ext/used'
import { ProjectSchema } from '../src/core/project'
import { writeFixture } from '../scripts/fixture'

enableFirstParty()

const project = writeFixture(mkdtempSync(join(tmpdir(), 'nkw-rp-')))
const target = { loader: 'fabric', mc: '1.21.1' } as const

describe('Roleplay extension', () => {
  afterAll(() => {
    extHost.clear()
    enableFirstParty()
  })

  it('adds its nodes, the timer pin type and the hand-harvest settings of the crop node', () => {
    for (const t of ['breakRule', 'regenBlock', 'gameCrop', 'harvestUi']) expect(registry.map[t]).toBeTruthy()
    expect(registry.pinColors.harvestUi).toBe('#84cc16')
    const crop = registry.map.crop
    expect(crop.props.map((p) => p.key)).toContain('breakDrops')
    expect(crop.inputs.some((p) => p.id === 'ui')).toBe(true)
    expect(crop.props.findIndex((p) => p.key === 'mode')).toBe(crop.props.findIndex((p) => p.key === 'growSeconds') + 1)
  })

  it('crops harvest by hand while it is on', () => {
    const { ir } = compile(project, target)
    expect(ir.blocks.some((b) => b.crop && b.crop.input !== 'break')).toBe(true)
    expect(ir.gameCrops.length).toBeGreaterThan(0)
    expect(ir.breakRules.length).toBeGreaterThan(0)
  })

  it('without it the crop is a plain plant and its nodes are unknown', () => {
    extHost.disable('roleplay')
    try {
      expect(registry.map.breakRule).toBeUndefined()
      expect(registry.map.crop.props.some((p) => p.key === 'mode')).toBe(false)
      const { ir, diagnostics } = compile(project, target)
      expect(ir.gameCrops).toEqual([])
      expect(ir.breakRules).toEqual([])
      for (const b of ir.blocks) if (b.crop) expect(b.crop).toMatchObject({ mode: 'replant', input: 'break', ui: null, adventure: true, sneak: false })
      expect(diagnostics.some((d) => d.needsExtension === 'roleplay')).toBe(true)
    } finally {
      enableFirstParty(['roleplay'])
    }
  })
})

describe('projects and missing extensions', () => {
  it('names the extension a node needs when it is not installed', () => {
    extHost.disable('thirst')
    try {
      const { diagnostics } = compile(project, target)
      const d = diagnostics.find((x) => x.needsExtension === 'thirst')!
      expect(d.severity).toBe('error')
      expect(d.message.en).toContain('"thirst" extension')
    } finally {
      enableFirstParty(['thirst'])
    }
  })

  it('a project remembers the extensions its nodes come from', () => {
    const used = usedExtensions(project.graph.nodes)
    expect(used.map((u) => u.id)).toEqual(['farmers-delight', 'roleplay', 'thirst'])
    expect(used.every((u) => u.version === '1.0.0')).toBe(true)
    expect(ProjectSchema.parse({ ...project, extensions: used }).extensions).toEqual(used)
  })

  it('a removed node of an old project keeps its data and its edges round-trip', () => {
    extHost.disable('roleplay')
    try {
      const again = ProjectSchema.parse(JSON.parse(JSON.stringify(project)))
      expect(again.graph.nodes.filter((n) => n.type === 'breakRule').length).toBeGreaterThan(0)
      expect(again.graph.edges.length).toBe(project.graph.edges.length)
      expect(usedExtensions(again.graph.nodes).map((u) => u.id)).toContain('roleplay')
    } finally {
      enableFirstParty(['roleplay'])
    }
  })
})
