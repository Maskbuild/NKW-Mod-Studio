import { describe, expect, it } from 'vitest'
import { formatSource, parseSource } from '../src/core/ext/source'

describe('extension source parsing', () => {
  it('accepts the usual ways to write a GitHub repository', () => {
    const base = { owner: 'Maskbuild', repo: 'nkw-ext-roleplay', ref: '', path: '' }
    expect(parseSource('Maskbuild/nkw-ext-roleplay')).toEqual(base)
    expect(parseSource('github.com/Maskbuild/nkw-ext-roleplay')).toEqual(base)
    expect(parseSource(' https://github.com/Maskbuild/nkw-ext-roleplay.git ')).toEqual(base)
    expect(parseSource('https://www.github.com/Maskbuild/nkw-ext-roleplay/')).toEqual(base)
    expect(parseSource('https://github.com/Maskbuild/nkw-ext-roleplay#v1.2.0')).toEqual({ ...base, ref: 'v1.2.0' })
    expect(parseSource('Maskbuild/NKW-Mod-Studio#main:extensions/roleplay')).toEqual({
      owner: 'Maskbuild',
      repo: 'NKW-Mod-Studio',
      ref: 'main',
      path: 'extensions/roleplay'
    })
    expect(parseSource('https://github.com/Maskbuild/NKW-Mod-Studio/tree/dev/extensions/thirst')).toEqual({
      owner: 'Maskbuild',
      repo: 'NKW-Mod-Studio',
      ref: 'dev',
      path: 'extensions/thirst'
    })
  })

  it('refuses other hosts, odd characters, traversal and mixed forms', () => {
    for (const bad of [
      '',
      'Maskbuild',
      'https://gitlab.com/a/b',
      'git@github.com:a/b.git',
      'http://evil.example/a/b',
      'a/b/c',
      'a/b#..',
      'a/b#main:../x',
      'a/b#main:/abs',
      'a/b#main:x//y',
      'a b/c',
      '-bad/repo',
      'a/b/tree/main/x#dev',
      'a/b/blob/main/x',
      'file:///etc/passwd',
      'a/b#x y'
    ])
      expect(parseSource(bad), bad).toBeNull()
  })

  it('writes a source back in one canonical form', () => {
    expect(formatSource({ owner: 'a', repo: 'b', ref: '', path: '' })).toBe('https://github.com/a/b')
    expect(formatSource({ owner: 'a', repo: 'b', ref: 'v1', path: 'x/y' })).toBe('https://github.com/a/b#v1:x/y')
  })
})
