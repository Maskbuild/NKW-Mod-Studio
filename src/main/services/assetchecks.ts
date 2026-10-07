import { open } from 'node:fs/promises'
import { extHost } from '@core/ext/host'
import { extensionSupports } from '@core/ext/support'
import type { ModIR } from '@core/ir'
import type { Target } from '@core/project'

/** Width and height of a PNG file from its header, or null when it is not a PNG. */
export async function pngSize(file: string): Promise<{ w: number; h: number } | null> {
  const fh = await open(file, 'r')
  try {
    const b = Buffer.alloc(24)
    const { bytesRead } = await fh.read(b, 0, 24, 0)
    if (bytesRead < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString('ascii', 12, 16) !== 'IHDR') return null
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  } finally {
    await fh.close()
  }
}

/**
 * The files named by extension records must be what the extension needs (a PNG of an allowed size …).
 * Returns the problems, one line each; nothing when everything fits.
 */
export async function checkExtAssets(ir: ModIR, target: Target, assetFile: (asset: string) => string): Promise<string[]> {
  const problems: string[] = []
  for (const ext of extHost.list()) {
    if (!extensionSupports(ext.manifest, target.loader, target.mc)) continue
    for (const c of ext.manifest.assetChecks) {
      for (const rec of ir.ext[ext.manifest.id]?.[c.slot] ?? []) {
        const asset = rec[c.field]
        const who = `${ext.manifest.name.en}: ${String(rec.id ?? rec.nodeId ?? c.slot)}`
        if (typeof asset !== 'string' || !asset) {
          if (!c.optional) problems.push(`${who}: no file chosen for "${c.field}"`)
          continue
        }
        if (!c.png) continue
        let size: { w: number; h: number } | null
        try {
          size = await pngSize(assetFile(asset))
        } catch {
          problems.push(`${who}: ${asset} cannot be read`)
          continue
        }
        if (!size) problems.push(`${who}: ${asset} is not a PNG file`)
        else if (c.png.square && size.w !== size.h) problems.push(`${who}: ${asset} is ${size.w}×${size.h} but must be square`)
        else if (c.png.sizes && (!c.png.sizes.includes(size.w) || !c.png.sizes.includes(size.h)))
          problems.push(`${who}: ${asset} is ${size.w}×${size.h}; allowed sizes: ${c.png.sizes.join(', ')}`)
      }
    }
  }
  return problems
}
