import { lazy, Suspense, useEffect } from 'react'
import i18n from './i18n'
import { api } from './api'
import { useStore } from './store'
import { Home } from './pages/Home'
import { Toasts } from './components/Toasts'
import { refreshExtensions } from './ext/extensions'

const Workspace = lazy(() => import('./pages/Workspace'))

export function App() {
  const page = useStore((s) => s.page)
  const settings = useStore((s) => s.settings)

  useEffect(() => {
    void api.settings().then((s) => useStore.getState().setSettings(s))
    void refreshExtensions()
  }, [])

  useEffect(() => {
    if (settings) {
      void i18n.changeLanguage(settings.language)
      document.documentElement.lang = settings.language
    }
  }, [settings?.language])

  if (!settings) return null
  return (
    <>
      {page === 'home' ? (
        <Home />
      ) : (
        <Suspense fallback={<div className="boot" />}>
          <Workspace />
        </Suspense>
      )}
      <Toasts />
    </>
  )
}
