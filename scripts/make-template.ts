/** Creates a template project for manual/visual testing: npx tsx scripts/make-template.ts starter .verify/starter */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { newProject } from '../src/core/project'
import { applyTemplate, type TemplateId } from '../src/main/templates'
import { createProjectDir, saveProject } from '../src/main/services/store'

async function main() {
  const id = (process.argv[2] ?? 'starter') as TemplateId
  const parent = resolve(process.argv[3] ?? '.verify')
  mkdirSync(parent, { recursive: true })
  let p = newProject({ name: `NKW ${id}`, modId: `nkw_${id.toLowerCase()}`, version: '1.0.0', authors: 'Nam Kueap Wan (NKW)', description: '' }, [
    { loader: 'fabric', mc: '1.21.1' },
    { loader: 'neoforge', mc: '1.21.1' },
    { loader: 'forge', mc: '1.20.1' }
  ])
  const dir = await createProjectDir(parent, `NKW ${id}`, p)
  p = await applyTemplate(dir, p, id)
  await saveProject(dir, p)
  console.log(dir)
}
void main()
