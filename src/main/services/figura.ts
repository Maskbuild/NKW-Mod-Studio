import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { figuraAvatars, type FiguraSkin } from '@core/figura'

/** Writes the Figura avatar folders of the skins under `target`; returns where and how many. */
export async function writeFiguraAvatars(
  skins: FiguraSkin[],
  mod: { name: string; authors: string },
  assetFile: (asset: string) => string,
  target: string
): Promise<{ dir: string; avatars: number }> {
  const root = resolve(target)
  const avatars = figuraAvatars(skins, mod)
  for (const a of avatars)
    for (const f of a.files) {
      const dest = resolve(root, a.dir, f.path)
      if (!dest.startsWith(root + sep)) throw new Error(`Unsafe path: ${f.path}`)
      await mkdir(dirname(dest), { recursive: true })
      if (f.text !== undefined) await writeFile(dest, f.text)
      else if (f.copy) await copyFile(assetFile(f.copy), dest)
    }
  return { dir: join(root), avatars: avatars.length }
}
