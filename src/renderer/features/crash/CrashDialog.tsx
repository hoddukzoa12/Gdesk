import { useCallback, useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { crashReportText, type CrashReport } from '@shared/domain/crash'
import '@shared/ipc/crash'
import { Button } from '@renderer/components'
import { invoke, useIpcEvent } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { installCrashListeners } from './capture'

type SendStatus = 'opened' | 'truncated' | 'copied' | 'failed'

function mergeReports(current: CrashReport[], incoming: CrashReport[]): CrashReport[] {
  const known = new Set(current.map((r) => r.id))
  const added = incoming.filter((r) => !known.has(r.id))
  return added.length > 0 ? [...current, ...added] : current
}

/**
 * 오류 보고 미리보기(spec §9). 처리되지 않은 오류가 나면 지운 보고 내용을 읽기 전용으로 보여 준다.
 * - 보내기: Gdesk 저장소가 있으면 새 이슈 페이지를 브라우저로 열고, 없으면 클립보드에 복사한다.
 * - 닫기: 아무것도 보내지 않는다.
 * 앱은 직접 전송하지 않는다. 화면 오류 감시(window error·unhandledrejection)도 여기서 설치한다.
 */
export function CrashDialog() {
  const { t } = useTranslation('crash')
  const [reports, setReports] = useState<CrashReport[]>([])
  const [status, setStatus] = useState<{ id: string; value: SendStatus } | null>(null)
  const [busy, setBusy] = useState(false)
  const report = reports[0] ?? null

  // 화면의 처리되지 않은 오류를 메인으로 보낸다(앱 틀을 고치지 않고 오버레이가 설치한다)
  useEffect(() => installCrashListeners(window), [])

  // 창이 뜨기 전(또는 다시 읽기 전)에 난 오류
  useEffect(() => {
    let alive = true
    invoke('crash:pending')
      .then((list) => {
        if (alive && Array.isArray(list)) setReports((prev) => mergeReports(prev, list))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const onShow = useCallback(({ report: next }: { report: CrashReport }) => {
    setReports((prev) => mergeReports(prev, [next]))
  }, [])
  useIpcEvent('crash:show', onShow)

  // 테스트 모드 전용(메인이 테스트 모드에서만 보낸다): 처리되지 않은 오류를 일부러 낸다
  const onTestThrow = useCallback(({ message }: { message: string }) => {
    setTimeout(() => {
      throw new Error(message)
    }, 0)
  }, [])
  useIpcEvent('crash:testThrow', onTestThrow)

  const close = useCallback(() => {
    if (!report) return
    void invoke('crash:dismiss', { id: report.id }).catch(() => {})
    setReports((prev) => prev.filter((r) => r.id !== report.id))
    setStatus(null)
  }, [report])

  const send = useCallback(async () => {
    if (!report) return
    setBusy(true)
    let value: SendStatus = 'failed'
    try {
      if (report.sendMode === 'issue') {
        const res = await invoke('crash:openIssue', { id: report.id })
        if (res.opened) value = res.truncated ? 'truncated' : 'opened'
      } else {
        const res = await invoke('crash:copy', { id: report.id })
        if (res.copied) value = 'copied'
      }
    } catch {
      value = 'failed'
    }
    setStatus({ id: report.id, value })
    setBusy(false)
  }, [report])

  if (!report) return null
  const currentStatus = status?.id === report.id ? status.value : null
  const remaining = reports.length - 1

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(640px,calc(100vw-32px))]',
            '-translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-border',
            'bg-bg-elevated p-4 text-fg shadow-xl'
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold">{t('dialog.title')}</Dialog.Title>
          <Dialog.Description className="text-[13px] text-fg-muted">
            {t('dialog.description')}{' '}
            {report.sendMode === 'issue' ? t('dialog.sendIssue') : t('dialog.sendCopy')}
          </Dialog.Description>
          <label className="flex min-h-0 flex-col gap-1 text-xs text-fg-muted">
            {t('dialog.previewLabel')}
            <textarea
              readOnly
              value={crashReportText(report)}
              spellCheck={false}
              className={cn(
                'h-72 min-h-0 w-full resize-none rounded-md border border-border bg-bg-subtle p-2',
                'font-mono text-xs text-fg select-text'
              )}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <p role="status" className="mr-auto text-xs text-fg-muted">
              {currentStatus ? t(`status.${currentStatus}`) : null}
              {remaining > 0 ? (
                <span className="ml-2">{t('dialog.more', { count: remaining })}</span>
              ) : null}
            </p>
            <Button onClick={close}>{t('dialog.close')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void send()}>
              {t('dialog.send')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
