import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/base.css'
import './theme.css'
import './app.css'
import './i18n'
import { App } from './App'
import { enableFirstParty } from '@core/ext/firstparty'

enableFirstParty()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
