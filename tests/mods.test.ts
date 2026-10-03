import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ProjectSchema } from '../src/core/project'
import { LINKED_MOD_RE, isGrowingBlockstate, mainNamespace } from '../src/core/vanilla'
import { importModJar, loadMod, modJarPath, vanillaIconPath } from '../src/main/services/vanilla'
import { compile } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { encodePng } from '../src/main/services/png'
import { writeFixture } from '../scripts/fixture'

/** A zip (stored, no compression) with the given files. */
function zip(files: Record<string, Buffer | string>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, raw] of Object.entries(files)) {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    const fn = Buffer.from(name)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fn.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(fn.length, 28)
    dir.writeUInt32LE(offset, 42)
    parts.push(local, fn, data)
    central.push(dir, fn)
    offset += 30 + fn.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

describe('linked mods', () => {
  it('finds crops by their growth stages and the mod namespace in a jar', () => {
    expect(isGrowingBlockstate({ variants: { 'age=0': {}, 'age=1': {}, 'age=7': {} } })).toBe(true)
    expect(isGrowingBlockstate({ variants: { 'age=0,half=lower': {}, 'age=3,half=upper': {} } })).toBe(true)
    expect(isGrowingBlockstate({ multipart: [{ when: { age: '3' }, apply: {} }] })).toBe(true)
    expect(isGrowingBlockstate({ variants: { '': {} } })).toBe(false)
    expect(isGrowingBlockstate({ variants: { 'facing=north': {} } })).toBe(false)
    expect(
      mainNamespace(['assets/minecraft/models/item/x.json', 'assets/rice/models/item/a.json', 'assets/rice/lang/en_us.json', 'assets/lib/lang/en_us.json'])
    ).toBe('rice')
    expect(mainNamespace(['data/x/recipes/a.json'])).toBeNull()
    expect(LINKED_MOD_RE.test('farmers-delight')).toBe(true)
    expect(LINKED_MOD_RE.test('file_rice')).toBe(true)
    expect(LINKED_MOD_RE.test('../evil')).toBe(false)
    expect(LINKED_MOD_RE.test('-x')).toBe(false)
  })

  it('keeps the linked mods in the project file', () => {
    const project = writeFixture(mkdtempSync(join(tmpdir(), 'nkw-mods-')))
    const ok = { ...project, mods: [{ id: 'farmers-delight', title: "Farmer's Delight", source: 'modrinth' }] }
    expect(ProjectSchema.safeParse(ok).success).toBe(true)
    expect(ProjectSchema.safeParse({ ...project, mods: [{ id: '../x', title: 'x', source: 'modrinth' }] }).success).toBe(false)
    expect(ProjectSchema.safeParse({ ...project, mods: [{ id: 'x', title: 'x', source: 'curseforge' }] }).success).toBe(false)
  })

  it('reads items, icons and crops of a .jar picked on disk', async () => {
    const tools = mkdtempSync(join(tmpdir(), 'nkw-tools-'))
    const png = encodePng(16, 16, () => [200, 180, 40, 255])
    const jar = join(tools, 'ricecraft-1.21.1-2.0.3.jar')
    writeFileSync(
      jar,
      zip({
        'assets/ricecraft/lang/en_us.json': JSON.stringify({ 'item.ricecraft.rice': 'Rice', 'block.ricecraft.rice_crop': 'Rice Crop' }),
        'assets/ricecraft/models/item/rice.json': JSON.stringify({ parent: 'item/generated', textures: { layer0: 'ricecraft:item/rice' } }),
        'assets/ricecraft/textures/item/rice.png': png,
        'assets/ricecraft/blockstates/rice_crop.json': JSON.stringify({ variants: { 'age=0': {}, 'age=1': {}, 'age=2': {} } }),
        'assets/ricecraft/blockstates/rice_bag.json': JSON.stringify({ variants: { '': {} } }),
        'data/ricecraft/tags/item/grains.json': JSON.stringify({ values: ['ricecraft:rice'] }),
        'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'ricecraft', version: '2.0.3' })
      })
    )
    const { id, data } = await importModJar(tools, '1.21.1', jar, () => undefined)
    // the version is left out of the id, so the same mod picked again for another version keeps its id
    expect(id).toBe('file_ricecraft')
    expect(data).toMatchObject({ ns: 'ricecraft', title: 'ricecraft-1.21.1-2.0.3', crops: ['rice_crop'], modId: 'ricecraft', loaders: ['fabric', 'quilt'] })
    // the jar is kept for test runs
    expect(readFileSync(modJarPath(tools, '1.21.1', id)).equals(readFileSync(jar))).toBe(true)
    expect(data.items.map((i) => [i.id, i.en, i.icon])).toEqual([['rice', 'Rice', true]])
    expect(data.tags).toEqual([{ id: 'ricecraft:grains', values: ['ricecraft:rice'] }])
    expect(await loadMod(tools, '1.21.1', id)).toEqual(data)
    const icon = vanillaIconPath(tools, '1.21.1', 'rice', `mod:${id}`)!
    expect(existsSync(icon) && readFileSync(icon).equals(png)).toBe(true)
    // ids are checked before they become paths
    expect(vanillaIconPath(tools, '1.21.1', 'rice', 'mod:../x')).toBeNull()
    await expect(loadMod(tools, '1.21.1', '../x')).rejects.toThrow()
  })

  it('adds linked mods to test runs and as dependencies of the mod', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nkw-mods-'))
    const project = writeFixture(dir)
    project.mods = [
      { id: 'jei', title: 'JEI', source: 'modrinth', role: 'test' },
      { id: 'rice', title: 'Rice', source: 'modrinth', role: 'required', modId: 'ricemod' },
      { id: 'file_spice', title: 'Spice', source: 'file', role: 'optional', modId: 'spice' },
      { id: 'big', title: 'Big', source: 'modrinth', role: 'optional' },
      { id: 'list', title: 'List only', source: 'modrinth', role: 'none', modId: 'listonly' }
    ]
    const read = { readText: (a: string) => readFileSync(join(dir, 'assets', a), 'utf8') }
    const linked = {
      linkedMods: [
        'maven.modrinth:jei:AAAA1111',
        'maven.modrinth:rice:BBBB2222',
        'maven.modrinth:architectury-api:CCCC3333',
        'maven.modrinth:farmers-delight:DDDD4444'
      ],
      localMods: ['file_spice']
    }
    const gen = (loader: 'fabric' | 'forge' | 'neoforge' | 'quilt', mc: string) => {
      const { ir, diagnostics } = compile(project, { loader, mc })
      const deps = { ...TOOL_VERSIONS, ...FALLBACK_DEPS[mc], farmersDelight: 'maven.modrinth:farmers-delight:DDDD4444', ...linked }
      const files = generate(ir, { loader, mc }, deps as never, read)
      return { ir, diagnostics, text: (end: string) => files.find((f) => f.path.endsWith(end))?.text ?? '' }
    }
    const fabric = gen('fabric', '1.21.1')
    // only required / optional mods with a known id become dependencies; the others warn
    expect(fabric.ir.dependsOn).toEqual([
      { modId: 'ricemod', title: 'Rice', required: true },
      { modId: 'spice', title: 'Spice', required: false }
    ])
    expect(fabric.diagnostics.some((d) => d.severity === 'warning' && d.message.en.startsWith('Big: its mod id is not known'))).toBe(true)
    const meta = JSON.parse(fabric.text('fabric.mod.json'))
    expect(meta.depends.ricemod).toBe('*')
    expect(meta.suggests).toEqual({ spice: '*' })
    const gradle = fabric.text('build.gradle')
    expect(gradle).toContain("modRuntimeOnly 'maven.modrinth:jei:AAAA1111'")
    expect(gradle).toContain("modRuntimeOnly 'maven.modrinth:architectury-api:CCCC3333'")
    expect(gradle).toContain("modRuntimeOnly files('nkw-mods/file_spice-1.jar')")
    // Farmer's Delight is already in the test run: not twice
    expect(gradle.match(/modRuntimeOnly 'maven\.modrinth:farmers-delight:/g)?.length).toBe(1)

    const quilt = JSON.parse(gen('quilt', '1.21.1').text('quilt.mod.json'))
    expect(quilt.quilt_loader.depends).toContainEqual('ricemod')
    expect(quilt.quilt_loader.depends).toContainEqual({ id: 'spice', optional: true })

    const forge = gen('forge', '1.20.1')
    expect(forge.text('build.gradle')).toContain("runtimeOnly fg.deobf('maven.modrinth:jei:AAAA1111')")
    expect(forge.text('build.gradle')).toContain("runtimeOnly fg.deobf('nkwlocal:file_spice:1')")
    expect(forge.text('build.gradle')).toContain("dir 'nkw-mods'")
    const toml = forge.text('META-INF/mods.toml')
    expect(toml).toContain('[[dependencies.nkwtest]]\nmodId="ricemod"\nmandatory=true')
    expect(toml).toContain('modId="spice"\nmandatory=false')

    const neo = gen('neoforge', '1.21.1')
    expect(neo.text('build.gradle')).toContain("runtimeOnly 'maven.modrinth:rice:BBBB2222'")
    expect(neo.text('build.gradle')).toContain("runtimeOnly files('nkw-mods/file_spice-1.jar')")
    expect(neo.text('META-INF/neoforge.mods.toml')).toContain('modId="ricemod"\ntype="required"')
    expect(neo.text('META-INF/neoforge.mods.toml')).toContain('modId="spice"\ntype="optional"')
  })
})
