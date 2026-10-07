/// <reference lib="webworker" />
import { compile } from '@core/compile/compile'
import { enableFirstParty } from '@core/ext/firstparty'
import type { Project, Target } from '@core/project'

enableFirstParty()

// Validation runs off the UI thread so typing and dragging stay smooth.
self.onmessage = (e: MessageEvent<{ seq: number; project: Project; target?: Target }>) => {
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
