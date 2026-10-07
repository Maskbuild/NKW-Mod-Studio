import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const THAI = new RegExp(`[${String.fromCharCode(0x0e00)}-${String.fromCharCode(0x0e7f)}]`)

const files = (dir: string): string[] => {
  try {
    return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
  } catch {
    return []
  }
}

/** The repository's own pages are English; only the Thai guide, the app's localised texts and test data may use Thai. */
describe('the release repository is written in English', () => {
  const list = [
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'package.json',
    'electron-builder.yml',
    'docs/EXTENSIONS.md',
    'docs/GUIDE.md',
    ...files('.github'),
    ...files('scripts').filter((f) => !f.endsWith('fixture.ts') && !f.endsWith('.json') && !f.includes('release-manifest')),
    'scripts/release-manifest.json',
    ...files('extensions').filter((f) => /README\.md$/.test(f))
  ]
  for (const f of list)
    it(f, () => {
      expect(THAI.test(readFileSync(f, 'utf8')), `${f} has Thai text`).toBe(false)
    })
})
