import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, FolderOpen, TriangleAlert } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { CloneFailureCode, CloneProgressEvent, OpenOutcome } from '@shared/domain/local'
import { Button, Spinner } from '@renderer/components'
import { invoke, useIpcEvent } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import {
  clampPercent,
  cloneFailureKey,
  cloneTargetPath,
  linkFailureKey,
  openFailureKey
} from './clone-logic'
import { useCloneAvailability, usePlatform, useRefreshLinks, useSettingsSnapshot } from './hooks'
import { closeCloneDialog, useCloneDialogState, type CloneTarget } from './store'

type Phase =
  | { kind: 'form' }
  | { kind: 'running'; cloneId: string; phase: string | null; percent: number }
  | { kind: 'cloned' | 'linked'; path: string; linkId: number }
  | { kind: 'exists'; path: string; sameRepo: boolean }
  | { kind: 'failed'; code: CloneFailureCode; detail: string }

/** 오류 등 한 줄 알림(대화상자 안) */
interface Notice {
  text: string
  /** 설정 화면 열기 버튼을 함께 보여 줄지 */
  settings?: boolean
}

function newCloneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `clone-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 클론 대화상자(spec §4.10). `requestClone` 으로 열린다(overlays 슬롯).
 * 열 때마다 seq 가 바뀌어 상태를 처음부터 시작한다.
 */
export function CloneDialog() {
  const { target, seq } = useCloneDialogState()
  if (!target) return null
  return <CloneDialogBody key={seq} target={target} seq={seq} />
}

function CloneDialogBody({ target, seq }: { target: CloneTarget; seq: number }) {
  const { t } = useTranslation('clone')
  const navigate = useNavigate()
  const settings = useSettingsSnapshot(seq)
  const platform = usePlatform()
  const availability = useCloneAvailability()
  const refreshLinks = useRefreshLinks()

  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  /** "변경…"으로 고른 부모 폴더. null 이면 설정의 클론 기본 폴더 */
  const [parentDir, setParentDir] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  // 진행 중인 클론 ID. 대화상자가 사라지면(다른 저장소로 다시 열림 등) 취소한다
  const runningRef = useRef<string | null>(null)
  useEffect(() => {
    const running = runningRef
    return () => {
      const id = running.current
      if (id) void invoke('local:cancelClone', { cloneId: id }).catch(() => {})
    }
  }, [])

  const onProgress = useCallback((event: CloneProgressEvent) => {
    setPhase((prev) =>
      prev.kind === 'running' && prev.cloneId === event.cloneId
        ? { ...prev, phase: event.phase, percent: clampPercent(event.percent) }
        : prev
    )
  }, [])
  useIpcEvent('local:cloneProgress', onProgress)

  const baseDir = parentDir ?? settings?.cloneBaseDir ?? null
  const targetPath = baseDir === null ? null : cloneTargetPath(baseDir, target.name, platform)
  const blockedReason =
    availability && !availability.available ? t(`dialog.blocked.${availability.reason}`) : null
  const canStart =
    phase.kind === 'form' && targetPath !== null && availability?.available === true && !busy

  const cancel = (): void => {
    const id = runningRef.current
    if (id) void invoke('local:cancelClone', { cloneId: id }).catch(() => {})
  }

  const onOpenChange = (open: boolean): void => {
    if (open) return
    if (phase.kind === 'running') {
      // 진행 중이면 취소만 한다. 'cancelled' 결과가 오면 닫힌다
      cancel()
      return
    }
    closeCloneDialog()
  }

  const chooseParent = async (): Promise<void> => {
    try {
      const res = await invoke('dialog:chooseFolder', baseDir ? { defaultPath: baseDir } : {})
      if (res.path) setParentDir(res.path)
    } catch {
      // 대화상자를 띄우지 못하면 그대로 둔다
    }
  }

  const start = async (): Promise<void> => {
    if (!canStart || targetPath === null) return
    const cloneId = newCloneId()
    runningRef.current = cloneId
    setNotice(null)
    setPhase({ kind: 'running', cloneId, phase: null, percent: 0 })
    try {
      const outcome = await invoke('local:clone', {
        cloneId,
        repoId: target.repoId,
        owner: target.owner,
        name: target.name,
        // 바꾸지 않았으면 메인이 `<클론 기본 폴더>/<이름>` 을 쓴다(화면 표시와 같은 값)
        ...(parentDir !== null ? { targetDir: targetPath } : {})
      })
      runningRef.current = null
      switch (outcome.kind) {
        case 'cloned':
          refreshLinks()
          setPhase({ kind: 'cloned', path: outcome.path, linkId: outcome.link.id })
          break
        case 'exists':
          setPhase({ kind: 'exists', path: outcome.path, sameRepo: outcome.sameRepo })
          break
        case 'cancelled':
          closeCloneDialog()
          break
        case 'failed':
          setPhase({ kind: 'failed', code: outcome.code, detail: outcome.detail })
          break
      }
    } catch (error) {
      runningRef.current = null
      setPhase({
        kind: 'failed',
        code: 'git_error',
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const linkExisting = async (path: string): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await invoke('local:link', { repoId: target.repoId, path })
      if (res.ok) {
        refreshLinks()
        const link = res.links.find((l) => l.repoId === target.repoId) ?? res.links[0]
        if (link) setPhase({ kind: 'linked', path: link.path, linkId: link.id })
      } else {
        setNotice({ text: t(linkFailureKey(res.reason)) })
      }
    } catch {
      setNotice({ text: t('linkFailure.unresolved') })
    } finally {
      setBusy(false)
    }
  }

  const openInEditor = async (linkId: number): Promise<void> => {
    setBusy(true)
    setNotice(null)
    let res: OpenOutcome
    try {
      res = await invoke('local:open', { linkId, target: 'editor' })
    } catch {
      res = { ok: false, reason: 'launch_failed' }
    }
    setBusy(false)
    if (res.ok) {
      refreshLinks()
      closeCloneDialog()
      return
    }
    setNotice({
      text: [t(openFailureKey(res.reason)), res.detail].filter(Boolean).join(' '),
      settings: res.reason === 'no_editor' || res.reason === 'unknown_editor'
    })
  }

  const fullName = `${target.owner}/${target.name}`

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          data-testid="clone-dialog"
          data-state-kind={phase.kind}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'flex-col gap-4 rounded-lg border border-border bg-bg-elevated p-4 text-fg shadow-xl'
          )}
        >
          <div className="flex flex-col gap-1">
            <Dialog.Title className="text-[15px] font-semibold">
              {t('dialog.title', { repo: fullName })}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-fg-muted">
              {t('dialog.description')}
            </Dialog.Description>
          </div>

          {(phase.kind === 'form' || phase.kind === 'running') && (
            <dl className="flex flex-col gap-3 text-[13px]">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-fg-muted">{t('dialog.target')}</dt>
                <dd className="flex items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg-subtle px-2 py-1 font-mono text-xs"
                    title={targetPath ?? undefined}
                    data-testid="clone-target-path"
                  >
                    {targetPath ?? t('dialog.loading')}
                  </span>
                  <Button
                    size="sm"
                    disabled={phase.kind !== 'form' || settings === null}
                    onClick={() => void chooseParent()}
                    data-testid="clone-change-target"
                  >
                    <FolderOpen aria-hidden />
                    {t('dialog.change')}
                  </Button>
                </dd>
                <dd className="text-xs text-fg-subtle">
                  {t('dialog.targetHint', { name: target.name })}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-fg-muted">{t('dialog.protocol')}</dt>
                <dd className="flex items-center gap-2">
                  <span className="font-medium" data-testid="clone-protocol">
                    {settings ? t(`dialog.protocols.${settings.cloneProtocol}`) : '…'}
                  </span>
                  <span className="text-xs text-fg-subtle">{t('dialog.protocolHint')}</span>
                </dd>
              </div>
            </dl>
          )}

          {phase.kind === 'running' && (
            <div className="flex flex-col gap-1.5" data-testid="clone-running">
              <div
                role="progressbar"
                aria-label={t('dialog.progressLabel')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase.percent}
                className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle"
                data-testid="clone-progress"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${phase.percent}%` }}
                />
              </div>
              <p
                className="flex items-center gap-2 text-xs text-fg-muted"
                data-testid="clone-phase"
              >
                <Spinner size={12} />
                <span className="min-w-0 flex-1 truncate">
                  {phase.phase ?? t('dialog.preparing')}
                </span>
                <span className="tabular-nums">{phase.percent}%</span>
              </p>
            </div>
          )}

          {(phase.kind === 'cloned' || phase.kind === 'linked') && (
            <p
              className="flex items-start gap-2 text-[13px]"
              data-testid="clone-success"
              data-path={phase.path}
            >
              <CircleCheck size={16} aria-hidden className="mt-px shrink-0 text-success" />
              <span className="min-w-0 break-all">
                {phase.kind === 'cloned'
                  ? t('dialog.success', { path: phase.path })
                  : t('dialog.linkedThisFolder', { path: phase.path })}
              </span>
            </p>
          )}

          {phase.kind === 'exists' && (
            <div
              className="flex items-start gap-2 text-[13px]"
              data-testid="clone-exists"
              data-same-repo={phase.sameRepo ? 'true' : 'false'}
            >
              <TriangleAlert size={16} aria-hidden className="mt-px shrink-0 text-warning" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium break-all">
                  {t('dialog.existsTitle', { path: phase.path })}
                </p>
                <p className="text-fg-muted">
                  {phase.sameRepo ? t('dialog.existsSame') : t('dialog.existsOther')}
                </p>
              </div>
            </div>
          )}

          {phase.kind === 'failed' && (
            <div
              role="alert"
              className="flex items-start gap-2 text-[13px]"
              data-testid="clone-failed"
              data-code={phase.code}
            >
              <CircleAlert size={16} aria-hidden className="mt-px shrink-0 text-danger" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-medium">{t('dialog.failedTitle')}</p>
                <p className="text-fg-muted">{t(cloneFailureKey(phase.code))}</p>
                {phase.detail && (
                  <details className="text-xs text-fg-muted">
                    <summary className="cursor-default select-none">{t('dialog.details')}</summary>
                    <pre
                      className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono whitespace-pre-wrap select-text"
                      data-testid="clone-failure-detail"
                    >
                      {phase.detail}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}

          {notice && (
            <div
              role="alert"
              className="flex items-center gap-2 text-xs text-danger"
              data-testid="clone-notice"
            >
              <span className="min-w-0 flex-1">{notice.text}</span>
              {notice.settings && (
                <Button
                  size="sm"
                  onClick={() => {
                    closeCloneDialog()
                    void navigate('/settings')
                  }}
                >
                  {t('feedback.openSettings')}
                </Button>
              )}
            </div>
          )}

          {phase.kind === 'form' && blockedReason && (
            <p className="text-xs text-warning" role="status" data-testid="clone-blocked-reason">
              {blockedReason}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            {phase.kind === 'form' && (
              <>
                <Button onClick={closeCloneDialog} data-testid="clone-close">
                  {t('dialog.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={!canStart}
                  title={blockedReason ?? undefined}
                  onClick={() => void start()}
                  data-testid="clone-start"
                >
                  {t('dialog.start')}
                </Button>
              </>
            )}
            {phase.kind === 'running' && (
              <Button onClick={cancel} data-testid="clone-cancel">
                {t('dialog.cancel')}
              </Button>
            )}
            {(phase.kind === 'cloned' || phase.kind === 'linked') && (
              <>
                <Button onClick={closeCloneDialog} data-testid="clone-close">
                  {t('dialog.close')}
                </Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void openInEditor(phase.linkId)}
                  data-testid="clone-open-editor"
                >
                  {t('dialog.openInEditor')}
                </Button>
              </>
            )}
            {phase.kind === 'exists' && (
              <>
                <Button onClick={closeCloneDialog} data-testid="clone-close">
                  {t('dialog.close')}
                </Button>
                {phase.sameRepo ? (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void linkExisting(phase.path)}
                    data-testid="clone-link-folder"
                  >
                    {t('dialog.linkThisFolder')}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => setPhase({ kind: 'form' })}
                    data-testid="clone-choose-another"
                  >
                    {t('dialog.chooseAnother')}
                  </Button>
                )}
              </>
            )}
            {phase.kind === 'failed' && (
              <>
                <Button onClick={closeCloneDialog} data-testid="clone-close">
                  {t('dialog.close')}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setPhase({ kind: 'form' })}
                  data-testid="clone-try-again"
                >
                  {t('dialog.tryAgain')}
                </Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
