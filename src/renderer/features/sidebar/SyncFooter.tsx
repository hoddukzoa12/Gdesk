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
import { useSyncStatus } from './useSyncStatus'

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

/** 사이드바 하단: 동기화 상태 + 새로고침 버튼(⌘R / Ctrl+R, 지금 화면 범위). */
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
      className="flex h-6 items-center gap-2 text-[11px] text-fg-muted"
      data-testid="sync-footer"
      data-connection={connection}
      data-syncing={busy || undefined}
    >
      {busy ? (
        <Spinner size={11} label={t('footer.syncing')} />
      ) : (
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dotClass[connection])} />
      )}
      <span className="min-w-0 flex-1 truncate" data-testid="sync-footer-text" title={text}>
        {text}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
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
