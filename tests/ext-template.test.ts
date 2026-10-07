import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { extHost } from '../src/core/ext/host'
import { loadExtension } from '../src/core/ext/manifest'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { newProject } from '../src/core/project'
import { readFolder } from '../src/main/services/extensions'

describe('the extension template', () => {
  it('is a valid extension that adds a node, a class and an init line', async () => {
    const r = loadExtension(await readFolder('extensions/_template'))
    if (!r.ok) throw new Error(r.errors.join('\n'))
    extHost.enable(r.ext)
    try {
      const p = newProject(
        { name: 'T', modId: 'tpl', version: '1.0.0', authors: 'a', description: '', license: 'MIT', homepage: '', issues: '', credits: [] },
        [{ loader: 'fabric', mc: '1.21.1' }]
      )
      p.graph = { nodes: [{ id: 'g', type: 'myGreeting', position: { x: 0, y: 0 }, data: { text: 'Hi "you"', times: 2 } }], edges: [] }
      const target = { loader: 'fabric' as const, mc: '1.21.1' }
      const { ir } = compile(p, target)
      const files = generate(ir, target, { ...TOOL_VERSIONS, ...FALLBACK_DEPS['1.21.1'], gradle: '8.14.3' }, { readText: () => '' })
      expect(files.find((f) => f.path.endsWith('/MyGreetings.java'))!.text).toContain('i < 2; i++) NkwMod.LOGGER.info("Hi \\"you\\"");')
      expect(files.find((f) => f.path.endsWith('/NkwMod.java'))!.text).toContain('MyGreetings.init();')
    } finally {
      extHost.clear()
    }
  })
})
