/** Just enough of semver for extension versions: "1.2.3" (and "1.2.3-beta.1"), plus simple ranges. */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export const isVersion = (v: string) => VERSION.test(v)

function parse(v: string): { n: [number, number, number]; pre: string } | null {
  const m = VERSION.exec(v)
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' } : null
}

/** Negative, 0 or positive like a comparator; a pre-release is older than the release. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) throw new Error(`Bad version "${!x ? a : b}"`)
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i]
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

/** "*", "1.2.3" (exact), ">=1.2.3", "^1" / "^1.2" / "^1.2.3" (same major, at least that). */
export function satisfies(version: string, range: string): boolean {
  const r = range.trim()
  if (r === '*' || r === '') return true
  let m: RegExpExecArray | null
  if ((m = /^>=\s*(\d+(?:\.\d+){0,2})$/.exec(r))) return compareVersions(version, pad(m[1])) >= 0
  if ((m = /^\^\s*(\d+(?:\.\d+){0,2})$/.exec(r))) {
    const base = pad(m[1])
    return compareVersions(version, base) >= 0 && parse(version)!.n[0] === parse(base)!.n[0]
  }
  if (isVersion(r)) return compareVersions(version, r) === 0
  throw new Error(`Bad version range "${range}"`)
}

/** Whether a range is one satisfies() understands. */
export function isRange(range: string): boolean {
  try {
    satisfies('0.0.0', range)
    return true
  } catch {
    return false
  }
}

const pad = (v: string) => `${v}${'.0'.repeat(2 - (v.split('.').length - 1))}`
