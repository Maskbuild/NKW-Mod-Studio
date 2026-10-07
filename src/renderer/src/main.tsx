import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/base.css'
import './theme.css'
import './app.css'
import './i18n'
import { App } from './App'

// while the app is developed the extensions of the repository's extensions/ folder are on from the start; the
// released app has none built in: they are installed from git (Settings → Extensions)
if (import.meta.env.DEV) await import('./devExtensions')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
