/**
 * Checks extension folders the way the app does when one is installed.
 *   npx tsx scripts/ext-validate.ts extensions/roleplay extensions/thirst
 *   npx tsx scripts/ext-validate.ts --all            (every folder of extensions/ except those starting with _)
 *   npx tsx scripts/ext-validate.ts --schema out/    (writes nkw-extension.schema.json and node.schema.json)
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { ManifestSchema, NodeFileSchema, loadExtension } from '../src/core/ext/manifest'
import { readFolder } from '../src/main/services/extensions'

async function main() {
  const args = process.argv.slice(2)
  const schemaAt = args.indexOf('--schema')
  if (schemaAt >= 0) {
    const out = resolve(args[schemaAt + 1] ?? '.')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'nkw-extension.schema.json'), JSON.stringify(z.toJSONSchema(ManifestSchema), null, 2) + '\n')
    writeFileSync(join(out, 'node.schema.json'), JSON.stringify(z.toJSONSchema(NodeFileSchema), null, 2) + '\n')
    console.log(`Schemas written to ${out}`)
    return
  }
  const dirs = args.includes('--all')
    ? readdirSync('extensions')
        .filter((d) => !d.startsWith('_') && statSync(join('extensions', d)).isDirectory())
        .map((d) => join('extensions', d))
    : args
  if (!dirs.length) {
    console.log('Usage: npx tsx scripts/ext-validate.ts <folder…> | --all | --schema <folder>')
    process.exit(2)
  }
  let failed = 0
  for (const dir of dirs) {
    try {
      const r = loadExtension(await readFolder(dir))
      if (r.ok) {
        const m = r.ext.manifest
        console.log(`✓ ${dir}: ${m.id} ${m.version} (${r.ext.nodes.length} nodes, ${m.generate.length} generators)`)
      } else {
        failed++
        console.log(`✗ ${dir}`)
        for (const e of r.errors) console.log(`    ${e}`)
      }
    } catch (e) {
      failed++
      console.log(`✗ ${dir}: ${(e as Error).message}`)
    }
  }
  process.exit(failed ? 1 : 0)
}
void main()
