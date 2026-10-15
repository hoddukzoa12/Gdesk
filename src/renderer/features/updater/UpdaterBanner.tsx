import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { UpdaterStatus } from '@shared/domain/updater'
import '@shared/ipc/updater'
import { Banner } from '@renderer/components'
import { invoke, useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

/** 메인이 보내는 상태 알림을 조회 캐시에 바로 넣는다. 설정 화면도 같은 캐시를 읽는다. */
export function useUpdaterStatus(): UpdaterStatus | undefined {
  const client = useQueryClient()
  const { data } = useIpcQuery('updater:getStatus')
  const onStatus = useCallback(
    (status: UpdaterStatus) => client.setQueryData(['updater:getStatus'], status),
    [client]
  )
  useIpcEvent('updater:status', onStatus)
  return data
}

/**
 * 업데이트 알림 배너.
 * - available(notify 방식): 새 버전이 나왔다고 알리고 다운로드 페이지를 연다.
 * - ready(auto 방식): 내려받은 업데이트를 지금 다시 시작해 적용한다.
 * 닫으면 같은 버전·상태에서는 다시 띄우지 않는다(앱을 다시 켜면 다시 보인다).
 */
export function UpdaterBanner() {
  const { t } = useTranslation('updater')
  const status = useUpdaterStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (!status || (status.state !== 'available' && status.state !== 'ready')) return null
  const key = `${status.state}:${status.version ?? ''}`
  if (dismissed === key) return null
  const version = status.version ?? ''

  if (status.state === 'available') {
    return (
      <Banner
        variant="info"
        title={t('available.title')}
        action={{
          label: t('available.action'),
          onClick: () => void invoke('updater:openDownloadPage')
        }}
        onDismiss={() => setDismissed(key)}
      >
        {t('available.body', { version })}
      </Banner>
    )
  }

  return (
    <Banner
      variant="info"
      title={t('ready.title')}
      action={{ label: t('ready.action'), onClick: () => void invoke('updater:install') }}
      onDismiss={() => setDismissed(key)}
    >
      {t('ready.body', { version })}
    </Banner>
  )
}
