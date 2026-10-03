import { overrideKey, type Project, type Target } from '../project'
import type { GenFile } from './types'

/**
 * Generated text files the user edited in the code view: the edited text replaces the generated one.
 * Only files the generator itself makes for this target can be replaced (no new or binary files).
 * Returns the files plus the paths that were replaced.
 */
export function applyOverrides(files: GenFile[], project: Project, target: Target): { files: GenFile[]; edited: Set<string> } {
  const edited = new Set<string>()
  const o = project.overrides
  if (!o) return { files, edited }
  const out = files.map((f) => {
    const text = o[overrideKey(target, f.path)]
    if (text === undefined || f.text === undefined) return f
    edited.add(f.path)
    return { ...f, text }
  })
  return { files: out, edited }
}
