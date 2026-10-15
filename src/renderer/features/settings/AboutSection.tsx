import { useState } from 'react'
import { Download, RefreshCw, RotateCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/app'
import '@shared/ipc/updater'
import { Button } from '@renderer/components'
import { invoke, useIpcQuery } from '@renderer/lib/ipc'
import { useUpdaterStatus } from '../updater/UpdaterBanner'
import { SettingRow, SettingsSection } from './ui'

/** 정보: 앱 버전과 업데이트 확인(spec §4.13, §10). */
export function AboutSection() {
  const { t } = useTranslation('settings')
  const { t: tUpdater } = useTranslation('updater')
  const client = useQueryClient()
  const info = useIpcQuery('app:info')
  const status = useUpdaterStatus()
  const [checking, setChecking] = useState(false)

  const state = status?.state
  const off = state === 'disabled' || state === 'unavailable'
  const busy = checking || state === 'checking' || state === 'downloading'

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      // 진행 상황은 updater:status 알림으로 오고, 응답(현재 상태)도 바로 반영한다
      client.setQueryData(['updater:getStatus'], await invoke('updater:check'))
    } catch {
      // 오류 상태는 updater:status 로 알려진다
    } finally {
      setChecking(false)
    }
  }

  const hint =
    state === 'disabled'
      ? t('about.disabledHint')
      : state === 'unavailable'
        ? t('about.unavailableHint')
        : state === 'available' && status?.mode === 'notify'
          ? t('about.notifyHint')
          : undefined

  return (
    <SettingsSection id="about" title={t('about.title')}>
      <SettingRow label={t('about.version')}>
        <span className="font-mono text-xs text-fg-muted" data-testid="settings-app-version">
          {info.data ? `${info.data.name} ${info.data.version}` : ''}
        </span>
      </SettingRow>
      <SettingRow
        label={t('about.updates')}
        hint={
          <>
            <span data-testid="settings-updater-status" data-state={state}>
              {status ? tUpdater(`status.${status.state}`, { version: status.version ?? '' }) : ''}
            </span>
            {hint && (
              <span className="block" data-testid="settings-updater-hint">
                {hint}
              </span>
            )}
          </>
        }
      >
        {state === 'available' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void invoke('updater:openDownloadPage')}
            data-testid="settings-updater-download"
          >
            <Download aria-hidden />
            {t('about.download')}
          </Button>
        )}
        {state === 'ready' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void invoke('updater:install')}
            data-testid="settings-updater-install"
          >
            <RotateCw aria-hidden />
            {t('about.restart')}
          </Button>
        )}
        <Button
          size="sm"
          disabled={!status || off || busy}
          onClick={() => void check()}
          data-testid="settings-updater-check"
        >
          <RefreshCw aria-hidden className={busy ? 'animate-spin' : undefined} />
          {tUpdater('check')}
        </Button>
      </SettingRow>
    </SettingsSection>
  )
}
