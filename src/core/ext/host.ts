import type { LoadedExtension } from './manifest'
import type { MappedExtension } from './mapping'
import { registry } from './registry'

/**
 * The extensions that are turned on right now. Enabling one adds its nodes, categories and pin types to the
 * registry and makes the compiler run its rules; disabling takes them away again.
 */
class ExtensionHost {
  private loaded = new Map<string, LoadedExtension>()

  enable(ext: LoadedExtension): void {
    const id = ext.manifest.id
    if (this.loaded.has(id)) throw new Error(`Extension "${id}" is already enabled`)
    registry.register(`ext:${id}`, ext.contribution)
    this.loaded.set(id, ext)
  }

  disable(id: string): void {
    if (!this.loaded.delete(id)) return
    registry.unregister(`ext:${id}`)
  }

  /** Turns off everything (tests, switching the set of extensions). */
  clear(): void {
    for (const id of [...this.loaded.keys()]) this.disable(id)
  }

  has(id: string): boolean {
    return this.loaded.has(id)
  }

  get(id: string): LoadedExtension | undefined {
    return this.loaded.get(id)
  }

  list(): LoadedExtension[] {
    return [...this.loaded.values()]
  }

  mapped(): MappedExtension[] {
    return this.list().map((e) => e.mapped)
  }
}

export const extHost = new ExtensionHost()
