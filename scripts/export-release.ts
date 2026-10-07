/**
 * Prepares the release repository: a clean copy of what the app needs, checked.
 *
 *   npx tsx scripts/export-release.ts --repo owner/name [--out release] [--verify]
 *
 * Writes `<out>/app` (the app repository), and `<out>/extensions/<id>` (each extension on its own, for people who
 * want one repository per extension). It never pushes anything. Checks: English only outside the guides and the
 * localised sources, no secrets, no huge files; `--verify` also installs, type-checks and tests the copy.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

interface Manifest {
  include: string[]
  exclude: string[]
  excludeSuffix: string[]
  englishOnlyExcept: string[]
  maxFileBytes: number
  secretPatterns: string[]
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const repo = arg('repo') ?? 'Maskbuild/NKW-Mod-Studio'
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error('--repo must look like owner/name')
const out = resolve(arg('out') ?? 'release')
const manifest = JSON.parse(readFileSync('scripts/release-manifest.json', 'utf8')) as Manifest
const THAI = new RegExp(`[${String.fromCharCode(0x0e00)}-${String.fromCharCode(0x0e7f)}]`)

function walk(dir: string, base = dir): string[] {
  const files: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) files.push(...walk(full, base))
    else if (e.isFile()) files.push(relative(base, full).split(sep).join('/'))
  }
  return files
}

function copyTree(from: string, to: string): void {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const name = src.split(sep).pop() ?? ''
      return !manifest.exclude.includes(name) && !manifest.excludeSuffix.some((s) => name.endsWith(s))
    }
  })
}

/** Problems found in a folder: Thai outside the allowed places, secrets, files that are too large. */
function check(root: string, english: boolean): string[] {
  const problems: string[] = []
  const secrets = manifest.secretPatterns.map((p) => new RegExp(p))
  for (const f of walk(root)) {
    const full = join(root, f)
    const size = statSync(full).size
    if (size > manifest.maxFileBytes) problems.push(`${f}: ${(size / 1e6).toFixed(1)} MB is too large`)
    if (/^\.env/.test(f.split('/').pop() ?? '')) problems.push(`${f}: environment file`)
    if (!/\.(ts|tsx|json|md|yml|yaml|css|html|cjs|tpl|txt|java|gradle|properties|toml)$/i.test(f)) continue
    const text = readFileSync(full, 'utf8')
    for (const re of secrets) if (re.test(text)) problems.push(`${f}: looks like a secret (${re.source.slice(0, 20)}…)`)
    if (english && THAI.test(text) && !manifest.englishOnlyExcept.some((x) => f === x || (x.endsWith('/') && f.startsWith(x))))
      problems.push(`${f}: has Thai text (only the Thai guide may)`)
  }
  return problems
}

function main() {
  rmSync(out, { recursive: true, force: true })
  const app = join(out, 'app')
  mkdirSync(app, { recursive: true })
  for (const item of manifest.include) if (existsSync(item)) copyTree(item, join(app, item))

  // the official extensions are installed from this repository
  const official = JSON.parse(readFileSync(join(app, 'src/core/ext/official.json'), 'utf8')) as { note: string; extensions: { id: string; source: string }[] }
  official.extensions = official.extensions.map((e) => ({ id: e.id, source: `${repo}#main:extensions/${e.id}` }))
  writeFileSync(join(app, 'src/core/ext/official.json'), JSON.stringify(official, null, 2) + '\n')

  const pkgPath = join(app, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
  pkg.repository = { type: 'git', url: `git+https://github.com/${repo}.git` }
  pkg.homepage = `https://github.com/${repo}#readme`
  pkg.bugs = { url: `https://github.com/${repo}/issues` }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  const readmePath = join(app, 'README.md')
  writeFileSync(
    readmePath,
    readFileSync(readmePath, 'utf8')
      .replace(/https:\/\/github\.com\/Maskbuild\/NKW-Mod-Studio\.git/g, `https://github.com/${repo}.git`)
      .replace(/cd NKW-Mod-Studio/g, `cd ${repo.split('/')[1]}`)
  )

  // each extension on its own
  const extRoot = join(app, 'extensions')
  const exts = readdirSync(extRoot).filter((d) => !d.startsWith('_') && statSync(join(extRoot, d)).isDirectory())
  for (const id of exts) {
    const dir = join(out, 'extensions', id)
    copyTree(join(extRoot, id), dir)
    const m = JSON.parse(readFileSync(join(extRoot, id, 'nkw-extension.json'), 'utf8')) as {
      name: { en: string }
      description: { en: string }
      version: string
    }
    writeFileSync(
      join(dir, 'README.md'),
      `# ${m.name.en}\n\n${m.description.en}\n\nAn extension for [NKW Mod Studio](https://github.com/${repo}). In the app open **Settings → Extensions** and install it from this repository's address.\n\nVersion ${m.version}. Written against the extension format described in [docs/EXTENSIONS.md](https://github.com/${repo}/blob/main/docs/EXTENSIONS.md).\n`
    )
    copyFileIfExists('LICENSE', join(dir, 'LICENSE'))
  }

  const problems = [...check(app, true), ...exts.flatMap((id) => check(join(out, 'extensions', id), false).map((p) => `extensions/${id}: ${p}`))]
  const files = walk(app).length
  console.log(`Release repository: ${app} (${files} files)`)
  console.log(`Extensions: ${exts.map((e) => join(out, 'extensions', e)).join(', ')}`)
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const p of problems) console.log(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log('Checks passed: English only outside the guides, no secrets, no large files.')

  if (process.argv.includes('--verify')) {
    for (const cmd of [
      ['npm', ['ci']],
      ['npm', ['run', 'typecheck']],
      ['npm', ['test']]
    ] as const) {
      console.log(`\n$ ${cmd[0]} ${cmd[1].join(' ')}`)
      const r = spawnSync(cmd[0], [...cmd[1]], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' })
      if (r.status !== 0) process.exit(r.status ?? 1)
    }
  }
  console.log('\nNothing was pushed. To publish: create the repository, then copy the contents of the app folder into it.')
}

function copyFileIfExists(from: string, to: string) {
  if (existsSync(from)) cpSync(from, to)
}

main()
