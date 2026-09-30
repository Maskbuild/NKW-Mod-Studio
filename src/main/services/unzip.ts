import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

/** Extracts a zip, refusing entries that would escape `destDir` (zip-slip). */
export function unzip(zipPath: string, destDir: string): Promise<void> {
  const root = resolve(destDir)
  return new Promise((ok, fail) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return fail(err ?? new Error('Cannot open zip'))
      zip.on('error', fail)
      zip.on('end', () => ok())
      zip.on('entry', (entry: yauzl.Entry) => {
        const target = resolve(root, entry.fileName)
        if (target !== root && !target.startsWith(root + sep)) {
          zip.close()
          return fail(new Error(`Unsafe zip entry: ${entry.fileName}`))
        }
        if (/\/$/.test(entry.fileName)) {
          mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail)
          return
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(e ?? new Error('Cannot read zip entry'))
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => zip.readEntry(), fail)
        })
      })
      zip.readEntry()
    })
  })
}
