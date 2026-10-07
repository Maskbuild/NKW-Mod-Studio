/// <reference lib="webworker" />
import { compile } from '@core/compile/compile'
import { applyBundle, type ExtBundle } from '@core/ext/bundle'
import type { Project, Target } from '@core/project'

if (import.meta.env.DEV) await import('./devExtensions')

// Validation runs off the UI thread so typing and dragging stay smooth.
self.onmessage = (e: MessageEvent<{ kind: 'ext'; bundle: ExtBundle } | { kind?: undefined; seq: number; project: Project; target?: Target }>) => {
  if (e.data.kind === 'ext') {
    applyBundle(e.data.bundle)
    return
  }
  const { seq, project, target } = e.data
  try {
    const { diagnostics } = compile(project, target)
    ;(self as unknown as Worker).postMessage({ seq, diagnostics })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      seq,
      diagnostics: [{ severity: 'error', message: { en: String(err), th: String(err) } }]
    })
  }
}
