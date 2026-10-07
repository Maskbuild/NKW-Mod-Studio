import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadExtension } from '../src/core/ext/manifest'
import { ExtensionStore, fetchFromGit, previewOf, readFolder, resolveRef, type GitNet } from '../src/main/services/extensions'
import { makeZip } from './helpers/zip'

const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const L = (en: string) => ({ en, th: en })

const manifest = (version = '1.0.0', extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: 1,
    id: 'demo-ext',
    name: L('Demo'),
    description: L('Demo'),
    version,
    categories: { demo: { label: L('Demo'), color: '#112233' } },
    nodes: ['nodes/n.json'],
    ...extra
  })
const node = JSON.stringify({ type: 'demoNode', category: 'demo', title: L('N'), description: L('N'), icon: 'x' })
const repoZip = (sha: string, version = '1.0.0', prefix = 'ext-' + sha.slice(0, 7), sub = '') =>
  makeZip({
    [`${prefix}/`]: '',
    [`${prefix}/${sub}nkw-extension.json`]: manifest(version),
    [`${prefix}/${sub}nodes/n.json`]: node,
    [`${prefix}/README.md`]: 'readme'
  })

/** A fake GitHub: routes api.github.com and codeload.github.com requests. */
function fakeNet(
  opts: { release?: string | null; branch?: string; commits?: Record<string, string>; zips?: Record<string, Buffer> } = {}
): GitNet & { calls: string[] } {
  const calls: string[] = []
  const commits = { v1: SHA, main: SHA2, ...opts.commits }
  return {
    calls,
    async getJson<T>(url: string): Promise<T> {
      calls.push(url)
      const m = /api\.github\.com\/repos\/([^/]+)\/([^/]+)(?:\/(releases\/latest|commits\/(.+)))?$/.exec(url)
      if (!m) throw new Error('bad url ' + url)
      if (m[2] === 'missing') throw new Error(`HTTP 404 for ${url}`)
      if (m[3] === 'releases/latest') {
        if (opts.release === null) throw new Error(`HTTP 404 for ${url}`)
        return { tag_name: opts.release ?? 'v1' } as T
      }
      if (m[4]) {
        const sha = commits[m[4] as keyof typeof commits]
        if (!sha) throw new Error(`HTTP 422 for ${url}`)
        return { sha } as T
      }
      return { default_branch: opts.branch ?? 'main' } as T
    },
    async getBuffer(url: string): Promise<Buffer> {
      calls.push(url)
      const m = /codeload\.github\.com\/[^/]+\/[^/]+\/zip\/([0-9a-f]{40})$/.exec(url)
      const zip = m && (opts.zips?.[m[1]] ?? repoZip(m[1]))
      if (!zip) throw new Error('bad url ' + url)
      return zip
    }
  }
}

describe('resolving a repository to one commit', () => {
  it('prefers the latest release, then the default branch, and honours a typed ref', async () => {
    const src = { owner: 'a', repo: 'b', ref: '', path: '' }
    expect(await resolveRef(fakeNet(), src)).toEqual({ sha: SHA, via: 'release', label: 'v1' })
    expect(await resolveRef(fakeNet({ release: null }), src)).toEqual({ sha: SHA2, via: 'default-branch', label: 'main' })
    expect(await resolveRef(fakeNet(), { ...src, ref: 'main' })).toEqual({ sha: SHA2, via: 'ref', label: 'main' })
    expect((await resolveRef(fakeNet(), { ...src, ref: SHA2.toUpperCase() })).sha).toBe(SHA2)
    await expect(resolveRef(fakeNet(), { ...src, ref: 'nope' })).rejects.toThrow(/422/)
  })

  it('does not hide errors other than "no release"', async () => {
    const net = fakeNet()
    net.getJson = async () => {
      throw new Error('HTTP 403 rate limit')
    }
    await expect(resolveRef(net, { owner: 'a', repo: 'b', ref: '', path: '' })).rejects.toThrow(/403/)
  })
})

describe('fetching and installing', () => {
  it('downloads the archive of the resolved commit (never of a moving branch)', async () => {
    const net = fakeNet()
    const got = await fetchFromGit(net, 'https://github.com/a/b')
    expect(net.calls.at(-1)).toBe(`https://codeload.github.com/a/b/zip/${SHA}`)
    expect(got.resolved.via).toBe('release')
    expect([...got.files.keys()].sort()).toEqual(['README.md', 'nkw-extension.json', 'nodes/n.json'])
    await expect(fetchFromGit(net, 'https://example.com/a/b')).rejects.toThrow(/not a GitHub repository/)
  })

  it('reads a folder of the repository', async () => {
    const net = fakeNet({ zips: { [SHA]: repoZip(SHA, '1.0.0', 'r-1', 'extensions/demo/') } })
    const got = await fetchFromGit(net, 'a/b#v1:extensions/demo')
    expect([...got.files.keys()].sort()).toEqual(['nkw-extension.json', 'nodes/n.json'])
  })

  it('validates, previews, installs, updates (keeping one older version), rolls back, disables and removes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nkw-ext-'))
    const store = new ExtensionStore(root)
    const got = await fetchFromGit(fakeNet(), 'a/b')
    const loaded = loadExtension(got.files)
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'))
    const preview = previewOf(loaded.ext, got.size, got.files.size)
    expect(preview).toMatchObject({ id: 'demo-ext', version: '1.0.0', nodes: 1, files: 3 })

    const rec = await store.install(loaded.ext, got.files, { source: 'https://github.com/a/b', sha: got.resolved.sha, via: 'release' })
    expect(rec.dir).toBe('demo-ext@aaaaaaaaaaaa')
    expect(existsSync(join(root, rec.dir, 'nodes', 'n.json'))).toBe(true)
    expect((await store.loadEnabled()).loaded.map((e) => e.manifest.id)).toEqual(['demo-ext'])

    // update to a new commit
    const got2 = await fetchFromGit(fakeNet({ release: null, zips: { [SHA2]: repoZip(SHA2, '1.1.0') } }), 'a/b')
    const l2 = loadExtension(got2.files)
    if (!l2.ok) throw new Error('bad')
    const rec2 = await store.install(l2.ext, got2.files, { source: 'https://github.com/a/b', sha: got2.resolved.sha, via: 'default-branch' })
    expect(rec2.version).toBe('1.1.0')
    expect(rec2.previous).toEqual([{ version: '1.0.0', sha: SHA, dir: 'demo-ext@aaaaaaaaaaaa' }])
    expect((await store.list()).length).toBe(1)

    const back = await store.rollback('demo-ext')
    expect(back.version).toBe('1.0.0')
    expect(back.previous[0].version).toBe('1.1.0')
    expect(JSON.parse(readFileSync(join(root, 'demo-ext@aaaaaaaaaaaa', 'nkw-extension.json'), 'utf8')).version).toBe('1.0.0')

    await store.setEnabled('demo-ext', false)
    expect((await store.loadEnabled()).loaded).toEqual([])
    await store.remove('demo-ext')
    expect(await store.list()).toEqual([])
    expect(existsSync(join(root, 'demo-ext@aaaaaaaaaaaa'))).toBe(false)
    expect(existsSync(join(root, 'demo-ext@bbbbbbbbbbbb'))).toBe(false)
  })

  it('reports a damaged cached extension instead of failing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nkw-ext-'))
    const store = new ExtensionStore(root)
    const got = await fetchFromGit(fakeNet(), 'a/b')
    const l = loadExtension(got.files)
    if (!l.ok) throw new Error('bad')
    const rec = await store.install(l.ext, got.files, { source: 's', sha: SHA, via: 'release' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(root, rec.dir, 'nkw-extension.json'), '{ broken')
    const r = await store.loadEnabled()
    expect(r.loaded).toEqual([])
    expect(r.problems[0].id).toBe('demo-ext')
  })

  it('refuses an extension that contains code', async () => {
    const zip = makeZip({ 'r-1/nkw-extension.json': manifest(), 'r-1/nodes/n.json': node, 'r-1/run.js': 'alert(1)' })
    const got = await fetchFromGit(fakeNet({ zips: { [SHA]: zip } }), 'a/b')
    const r = loadExtension(got.files)
    expect(r.ok).toBe(false)
  })

  it('installs from a local folder while developing', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'nkw-dev-'))
    mkdirSync(join(dir, 'nodes'))
    writeFileSync(join(dir, 'nkw-extension.json'), manifest())
    writeFileSync(join(dir, 'nodes', 'n.json'), node)
    const files = await readFolder(dir)
    expect([...files.keys()].sort()).toEqual(['nkw-extension.json', 'nodes/n.json'])
  })
})
