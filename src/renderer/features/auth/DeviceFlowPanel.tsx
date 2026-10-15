import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink as ExternalIcon, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DeviceFlowProgress } from '@shared/domain/session'
import '@shared/ipc/auth'
import { Button, Spinner } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { authErrorKey, deviceFlowView } from './messages'

interface DeviceFlowPanelProps {
  flow: DeviceFlowProgress | undefined
  /** 토큰 로그인 등 다른 시도가 진행 중이면 시작 버튼을 막는다 */
  disabled: boolean
}

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * 브라우저 코드 로그인(GitHub 기기 인증). 코드를 보여 주고, 사용자가 GitHub 에서 입력해 승인하면
 * 메인이 로그인을 끝낸다(세션 알림으로 화면이 바뀐다).
 */
export function DeviceFlowPanel({ flow, disabled }: DeviceFlowPanelProps) {
  const { t } = useTranslation('auth')
  const view = deviceFlowView(flow)
  const [startError, setStartError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copy, setCopy] = useState<CopyState>('idle')

  useEffect(() => {
    if (copy === 'idle') return
    const id = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(id)
  }, [copy])

  const start = async (): Promise<void> => {
    setStartError(null)
    setBusy(true)
    try {
      const res = await invoke('auth:startDeviceFlow')
      if (!res.ok) setStartError(authErrorKey(res.error))
    } catch {
      setStartError('errors.httpError')
    } finally {
      setBusy(false)
    }
  }

  const cancel = (): void => {
    void invoke('auth:cancelDeviceFlow').catch(() => {})
  }

  const copyCode = async (): Promise<void> => {
    if (!flow?.userCode) return
    try {
      await navigator.clipboard.writeText(flow.userCode)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  const startButton = (label: string) => (
    <Button
      variant="primary"
      className="w-full justify-center"
      disabled={disabled || busy}
      onClick={() => void start()}
      data-testid="device-flow-start"
    >
      <Globe aria-hidden />
      {label}
    </Button>
  )

  return (
    <section aria-labelledby="device-flow-title" className="flex flex-col gap-3">
      <div>
        <h2 id="device-flow-title" className="text-[13px] font-semibold">
          {t('device.title')}
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">{t('device.description')}</p>
      </div>

      {view === 'idle' && startButton(t('device.start'))}

      {view === 'requesting' && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner size={14} label={t('device.requesting')} />
          <span>{t('device.requesting')}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={cancel}>
            {t('device.cancel')}
          </Button>
        </div>
      )}

      {view === 'pending' && flow && (
        <div className="flex flex-col gap-3" data-testid="device-flow-pending">
          <p className="text-xs text-fg-muted">{t('device.enterCode')}</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2">
            <code
              className="min-w-0 flex-1 font-mono text-2xl font-semibold tracking-[0.2em] text-fg select-all"
              data-testid="device-user-code"
            >
              {flow.userCode}
            </code>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void copyCode()}
              aria-label={t('device.copy')}
              title={t('device.copy')}
            >
              {copy === 'copied' ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
          <p role="status" className="min-h-4 text-xs text-fg-muted">
            {copy === 'copied'
              ? t('device.copied')
              : copy === 'failed'
                ? t('device.copyFailed')
                : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => void invoke('auth:openVerificationUri').catch(() => {})}
              data-testid="device-flow-open"
            >
              <ExternalIcon aria-hidden />
              {t('device.openGitHub')}
            </Button>
            <Button onClick={cancel}>{t('device.cancel')}</Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Spinner size={12} label={t('device.waiting')} />
            <span>{t('device.waiting')}</span>
          </div>
        </div>
      )}

      {(view === 'expired' || view === 'denied' || view === 'error') && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-xs text-danger" data-testid="device-flow-status">
            {t(`device.status.${view}`)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={disabled || busy}
              onClick={() => void start()}
              data-testid="device-flow-retry"
            >
              {t('device.retry')}
            </Button>
            <Button onClick={cancel}>{t('device.cancel')}</Button>
          </div>
        </div>
      )}

      {startError && view === 'idle' && (
        <p role="alert" className="text-xs text-danger">
          {t(startError)}
        </p>
      )}
    </section>
  )
}
