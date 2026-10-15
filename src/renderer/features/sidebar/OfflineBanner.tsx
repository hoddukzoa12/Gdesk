import { useTranslation } from 'react-i18next'
import { Banner, useNow } from '@renderer/components'
import { sinceText } from './footerText'
import { useSyncStatus } from '@renderer/lib/hooks/useSyncStatus'

/** 오프라인 배너 (spec §6). 세션 만료 배너는 인증 작업이 맡는다. */
export function OfflineBanner() {
  const { t, i18n } = useTranslation('sidebar')
  const status = useSyncStatus()
  const now = useNow(5_000)
  if (status?.connection !== 'offline') return null
  const last = status.lastSyncedAt
  return (
    <div data-testid="offline-banner">
      <Banner variant="warning" title={t('banner.offlineTitle')}>
        {last === null
          ? t('banner.offlineNoData')
          : t('banner.offline', { time: sinceText(last, now, i18n.language) })}
      </Banner>
    </div>
  )
}
