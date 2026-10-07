/**
 * Where an extension comes from: a GitHub repository (optionally a branch/tag/commit and a folder inside it).
 *   owner/repo
 *   github.com/owner/repo
 *   https://github.com/owner/repo#v1.2.0
 *   https://github.com/owner/repo#main:extensions/roleplay
 *   https://github.com/owner/repo/tree/main/extensions/roleplay
 * Parsing is strict: anything that is not clearly a GitHub repository is refused.
 */

export interface GitSource {
  owner: string
  repo: string
  /** branch, tag or commit (empty: the latest release, else the default branch) */
  ref: string
  /** folder of the repository that holds nkw-extension.json ('' = the root) */
  path: string
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._/-]{1,100}$/
const SUBPATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

export function parseSource(input: string): GitSource | null {
  let s = input.trim()
  if (!s || s.length > 300) return null
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  if (/^github\.com\//i.test(s)) s = s.slice('github.com/'.length)
  else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s)) return null // some other host
  let ref = ''
  let path = ''
  const hash = s.indexOf('#')
  if (hash >= 0) {
    const frag = s.slice(hash + 1)
    s = s.slice(0, hash)
    const colon = frag.indexOf(':')
    ref = colon >= 0 ? frag.slice(0, colon) : frag
    path = colon >= 0 ? frag.slice(colon + 1) : ''
  }
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '')
  const parts = s.split('/')
  if (parts.length < 2) return null
  const [owner, repo, ...rest] = parts
  if (rest.length) {
    // .../tree/<ref>/<path…>   (the ref is one segment: a branch with a slash needs the #ref:path form)
    if (rest[0] !== 'tree' || rest.length < 2 || ref || path) return null
    ref = rest[1]
    path = rest.slice(2).join('/')
  }
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null
  if (ref && (!REF.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.endsWith('/'))) return null
  if (path && (!SUBPATH.test(path) || path.split('/').some((p) => p === '..' || p === '.'))) return null
  return { owner, repo, ref, path }
}

export const formatSource = (s: GitSource): string =>
  `https://github.com/${s.owner}/${s.repo}${s.ref || s.path ? `#${s.ref}${s.path ? `:${s.path}` : ''}` : ''}`

export const isCommitSha = (v: string) => /^[0-9a-f]{40}$/i.test(v)
