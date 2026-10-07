import yauzl from 'yauzl'

export interface ZipLimits {
  files: number
  /** bytes of all files together, uncompressed */
  total: number
  /** bytes of one file, uncompressed */
  file: number
}

export const EXTENSION_ZIP_LIMITS: ZipLimits = { files: 2000, total: 100_000_000, file: 20_000_000 }

/** File types read as text (the rest stays bytes). */
const TEXT = /\.(json|tpl|md|txt|lua|properties|mcmeta|cfg|toml|yml|yaml)$/i

/**
 * Reads a zip held in memory into path → content, refusing zip bombs (counts and sizes are checked against
 * the declared sizes *and* while reading), unsafe names and symbolic links. Paths are returned without the
 * single top folder a GitHub archive wraps everything in; `subdir` keeps only that folder of the repository.
 */
export function readZip(buf: Buffer, subdir = '', limits: ZipLimits = EXTENSION_ZIP_LIMITS): Promise<Map<string, string | Uint8Array>> {
  return new Promise((ok, fail) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return fail(err ?? new Error('Not a valid zip file'))
      const raw: { name: string; data: Buffer }[] = []
      let count = 0
      let total = 0
      const abort = (e: Error) => {
        zip.close()
        fail(e)
      }
      zip.on('error', fail)
      zip.on('end', () => {
        try {
          ok(finish(raw, subdir))
        } catch (e) {
          fail(e as Error)
        }
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName
        if (++count > limits.files) return abort(new Error(`The archive has too many files (more than ${limits.files})`))
        if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /^[A-Za-z]:/.test(name))
          return abort(new Error(`Unsafe name in the archive: ${name}`))
        // unix mode in the high 16 bits of the external attributes: 0o120000 is a symbolic link
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) return abort(new Error(`Symbolic links are not allowed: ${name}`))
        if (name.endsWith('/')) return zip.readEntry()
        if (entry.uncompressedSize > limits.file) return abort(new Error(`${name} is too large`))
        total += entry.uncompressedSize
        if (total > limits.total) return abort(new Error('The archive is too large when unpacked'))
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return abort(e ?? new Error(`Cannot read ${name}`))
          const chunks: Buffer[] = []
          let size = 0
          stream.on('data', (c: Buffer) => {
            size += c.length
            if (size > limits.file) {
              stream.destroy()
              abort(new Error(`${name} is too large`))
            } else chunks.push(c)
          })
          stream.on('error', abort)
          stream.on('end', () => {
            raw.push({ name, data: Buffer.concat(chunks) })
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

function finish(raw: { name: string; data: Buffer }[], subdir: string): Map<string, string | Uint8Array> {
  if (!raw.length) throw new Error('The archive is empty')
  const tops = new Set(raw.map((r) => r.name.split('/')[0]))
  // GitHub wraps a repository in one folder (repo-<sha>/): drop it
  const strip = tops.size === 1 && raw.every((r) => r.name.includes('/')) ? [...tops][0] + '/' : ''
  const prefix = subdir ? `${strip}${subdir.replace(/\/+$/, '')}/` : strip
  const out = new Map<string, string | Uint8Array>()
  for (const { name, data } of raw) {
    if (!name.startsWith(prefix)) continue
    const rel = name.slice(prefix.length)
    if (!rel) continue
    out.set(rel, TEXT.test(rel) ? data.toString('utf8') : new Uint8Array(data))
  }
  if (!out.size) throw new Error(subdir ? `The folder "${subdir}" was not found in the repository` : 'The archive has no files')
  return out
}
