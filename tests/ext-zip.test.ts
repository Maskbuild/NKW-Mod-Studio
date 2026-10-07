import { describe, expect, it } from 'vitest'
import { readZip } from '../src/main/services/zipread'
import { makeZip } from './helpers/zip'

describe('reading an extension archive', () => {
  it('drops the GitHub wrapper folder and reads text and binary files', async () => {
    const zip = makeZip({
      'repo-abc123/': '',
      'repo-abc123/nkw-extension.json': '{"a":1}',
      'repo-abc123/nodes/x.json': '{}',
      'repo-abc123/assets/icon.png': Buffer.from([1, 2, 3])
    })
    const files = await readZip(zip)
    expect([...files.keys()].sort()).toEqual(['assets/icon.png', 'nkw-extension.json', 'nodes/x.json'])
    expect(files.get('nkw-extension.json')).toBe('{"a":1}')
    expect(files.get('assets/icon.png')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('keeps only a sub-folder when asked', async () => {
    const zip = makeZip({
      'r-1/README.md': 'x',
      'r-1/extensions/roleplay/nkw-extension.json': '{}',
      'r-1/extensions/roleplay/nodes/a.json': '{}',
      'r-1/extensions/thirst/nkw-extension.json': '{}'
    })
    const files = await readZip(zip, 'extensions/roleplay')
    expect([...files.keys()].sort()).toEqual(['nkw-extension.json', 'nodes/a.json'])
    await expect(readZip(zip, 'extensions/nope')).rejects.toThrow(/not found/)
  })

  it('refuses unsafe names, symbolic links, too many files and oversized files', async () => {
    await expect(readZip(makeZip({ 'r/../evil.txt': 'x' }))).rejects.toThrow(/Unsafe|invalid relative path|absolute path/)
    await expect(readZip(makeZip({ '/abs.txt': 'x' }))).rejects.toThrow(/Unsafe|invalid relative path|absolute path/)
    await expect(readZip(makeZip({ 'r/link': 'target' }, { symlink: ['r/link'] }))).rejects.toThrow(/Symbolic/)
    const many: Record<string, string> = {}
    for (let i = 0; i < 12; i++) many[`r/f${i}.json`] = '{}'
    await expect(readZip(makeZip(many), '', { files: 10, total: 1e6, file: 1e6 })).rejects.toThrow(/too many files/)
    await expect(readZip(makeZip({ 'r/big.bin': Buffer.alloc(2000) }), '', { files: 10, total: 1e6, file: 1000 })).rejects.toThrow(/too large/)
    await expect(readZip(makeZip({ 'r/a.bin': Buffer.alloc(600), 'r/b.bin': Buffer.alloc(600) }), '', { files: 10, total: 1000, file: 1000 })).rejects.toThrow(
      /too large/
    )
  })

  it('refuses a file that is bigger than its header says, and garbage', async () => {
    const lying = makeZip({ 'r/a.bin': Buffer.alloc(5000) }, { lieAboutSize: { 'r/a.bin': 10 } })
    await expect(readZip(lying, '', { files: 10, total: 1e6, file: 1000 })).rejects.toThrow()
    await expect(readZip(Buffer.from('not a zip'))).rejects.toThrow()
    await expect(readZip(makeZip({}))).rejects.toThrow(/empty/)
  })
})
