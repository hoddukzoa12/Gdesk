import { useTranslation } from 'react-i18next'
import '@shared/ipc/app'
import { useIpcQuery } from '@renderer/lib/ipc'

export function AboutPage() {
  const { t } = useTranslation('about')
  const info = useIpcQuery('app:info')

  return (
    <section className="p-6" data-testid="about-page">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      {info.data && (
        <p className="text-fg-muted mt-2">
          {t('version', { name: info.data.name, version: info.data.version })}
        </p>
      )}
    </section>
  )
}
