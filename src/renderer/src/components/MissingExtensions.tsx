import { useTranslation } from 'react-i18next'
import { extHost } from '@core/ext/host'
import { extensionOfType } from '@core/ext/used'
import { useStore } from '../store'
import { useRegistryVersion } from '../ext/useRegistry'

/** A strip above the canvas when the project needs extensions that are not installed. */
export function MissingExtensions({ onInstall }: { onInstall: () => void }) {
  const { t } = useTranslation()
  useRegistryVersion()
  const projectExt = useStore((s) => s.projectExt)
  const nodes = useStore((s) => s.nodes)
  const needed = new Set<string>(projectExt)
  for (const n of nodes) {
    const id = extensionOfType(n.type as string)
    if (id) needed.add(id)
  }
  const missing = [...needed].filter((id) => !extHost.has(id)).sort()
  if (!missing.length) return null
  return (
    <div className="missing-ext" role="alert">
      <span className="grow">{t('ext.missingBanner', { list: missing.map((id) => t(`ext.officialNames.${id}`, { defaultValue: id })).join(', ') })}</span>
      <button className="btn small primary" onClick={onInstall}>
        {t('ext.install')}
      </button>
    </div>
  )
}
