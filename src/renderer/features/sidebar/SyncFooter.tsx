import { useEffect, useEffectEvent, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { AppPlatform } from '@shared/domain/app'
import '@shared/ipc/sync'
import { Button, Spinner, useNow } from '@renderer/components'
import { usePlatform } from '@renderer/app/platform'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { footerText } from './footerText'
import { scopeForPathname } from './refreshScope'
import { useSyncStatus } from '@renderer/lib/hooks/useSyncStatus'

/** ⌘R(맥) / Ctrl+R(그 외) 인가 */
export function isRefreshShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: AppPlatform
): boolean {
  if (e.key.toLowerCase() !== 'r' || e.altKey || e.shiftKey) return false
  return platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

const dotClass = {
  online: 'bg-success',
  offline: 'bg-warning',
  rate_limited: 'bg-warning',
  session_expired: 'bg-danger'
} as const

/**
 * 상단 막대 오른쪽(spec §4.2): 동기화 상태 문구 + 새로고침 버튼(⌘R / Ctrl+R, 지금 화면 범위).
 * 예전 사이드바 하단에서 옮겨 왔다. 화면 테스트가 쓰는 data-testid(sync-footer·sync-footer-text·sync-refresh)는 그대로 둔다.
 */
export function SyncFooter() {
  const { t, i18n } = useTranslation('sidebar')
  const status = useSyncStatus()
  const now = useNow(5_000)
  const platform = usePlatform()
  const { pathname } = useLocation()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = () => {
    setRefreshing(true)
    invoke('sync:refresh', { scope: scopeForPathname(pathname) })
      .catch(() => undefined)
      .finally(() => setRefreshing(false))
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || !isRefreshShortcut(e, platform)) return
    e.preventDefault()
    refresh()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const connection = status?.connection ?? 'online'
  const busy = refreshing || (status?.syncing ?? false)
  const text = status ? footerText(status, now, i18n.language, t) : ''
  const shortcut = platform === 'darwin' ? '⌘R' : 'Ctrl+R'

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted"
      data-testid="sync-footer"
      data-connection={connection}
      data-syncing={busy || undefined}
    >
      {busy ? (
        <Spinner size={11} label={t('footer.syncing')} />
      ) : (
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dotClass[connection])} />
      )}
      <span
        className="max-w-[240px] min-w-0 truncate whitespace-nowrap"
        data-testid="sync-footer-text"
        title={text}
      >
        {text}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="ml-0.5"
        onClick={refresh}
        disabled={refreshing}
        aria-label={t('footer.refresh', { shortcut })}
        title={t('footer.refresh', { shortcut })}
        data-testid="sync-refresh"
      >
        <RefreshCw />
      </Button>
    </div>
  )
}
