import { useCallback, useMemo, useState } from 'react'
import { FolderSync, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { LocalLink } from '@shared/domain/link'
import type { LinkFailureReason, LinkedFolder, ScanSummary } from '@shared/domain/local'
import '@shared/ipc/dialog'
import '@shared/ipc/local'
import '@shared/ipc/queries'
import { Badge, Button, ErrorState, Spinner } from '@renderer/components'
import { invoke, useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'
import { ConfirmDialog, SettingsSection } from './ui'

const LINKS_KEY = ['local:listLinks']

/** 저장소 ID → `owner/name`. 내 저장소(포크·보관 포함)와 스타한 저장소에서 찾는다. */
function useRepoNames(): Map<number, string> {
  const repos = useIpcQuery('query:repositories', { includeForks: true, includeArchived: true })
  const starred = useIpcQuery('query:starred', {})
  return useMemo(() => {
    const names = new Map<number, string>()
    for (const r of starred.data ?? []) names.set(r.id, r.fullName)
    for (const r of repos.data?.items ?? []) names.set(r.id, r.fullName)
    return names
  }, [repos.data, starred.data])
}

type Notice = { kind: 'scan'; summary: ScanSummary } | { kind: 'error'; message: string } | null

/** 연결된 폴더 관리(spec §4.11): 연결 해제(폴더는 지우지 않음), 다시 연결, 폴더 다시 찾기. */
export function LinkedFoldersSection() {
  const { t } = useTranslation('settings')
  const { t: tl } = useTranslation('links')
  const client = useQueryClient()
  const links = useIpcQuery('local:listLinks', {})
  const names = useRepoNames()
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [unlinkTarget, setUnlinkTarget] = useState<LocalLink | null>(null)

  // local:listLinks 는 query: 채널이 아니라 자동으로 다시 읽히지 않는다.
  // 연결이 바뀌면 메인이 data:changed 를 보내므로 그때 다시 읽는다(시작 찾기, 클론 등).
  const reload = useCallback(() => void client.invalidateQueries({ queryKey: LINKS_KEY }), [client])
  useIpcEvent('data:changed', reload)

  const rescan = async (): Promise<void> => {
    setScanning(true)
    setNotice(null)
    try {
      const summary = await invoke('local:rescan')
      setNotice({ kind: 'scan', summary })
    } catch {
      setNotice({ kind: 'error', message: t('folders.rescanError') })
    } finally {
      setScanning(false)
      reload()
    }
  }

  const unlink = async (): Promise<void> => {
    if (!unlinkTarget) return
    try {
      await invoke('local:unlink', { linkId: unlinkTarget.id })
      setUnlinkTarget(null)
      setNotice(null)
    } catch {
      setNotice({ kind: 'error', message: t('folders.unlinkError') })
      setUnlinkTarget(null)
    } finally {
      reload()
    }
  }

  const relink = async (link: LocalLink): Promise<void> => {
    setNotice(null)
    try {
      const chosen = await invoke('dialog:chooseFolder', { defaultPath: link.path })
      if (!chosen.path) return
      const outcome = await invoke('local:relink', { linkId: link.id, path: chosen.path })
      if (!outcome.ok) {
        setNotice({ kind: 'error', message: relinkMessage(outcome.reason) })
      }
    } catch {
      setNotice({ kind: 'error', message: relinkMessage('failed') })
    } finally {
      reload()
    }
  }

  const relinkMessage = (reason: LinkFailureReason | 'failed'): string =>
    t(`folders.relinkErrors.${reason}`)

  let body
  if (links.isError && !links.data) {
    body = <ErrorState message={t('folders.loadError')} onRetry={() => void links.refetch()} />
  } else if (!links.data) {
    body = (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  } else if (links.data.length === 0) {
    body = (
      <p className="px-4 py-3 text-[13px] text-fg-muted" data-testid="settings-links-empty">
        {t('folders.empty')}
      </p>
    )
  } else {
    body = (
      <ul data-testid="settings-links">
        {links.data.map((link: LinkedFolder) => (
          <li
            key={link.id}
            className="flex items-center gap-3 border-t border-border px-4 py-2 text-[13px]"
            data-testid={`settings-link-${link.id}`}
            data-repo-id={link.repoId}
            data-status={link.status}
            data-access={link.accessStatus}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-fg" data-testid="settings-link-repo">
                  {names.get(link.repoId) ?? link.fullName ?? `#${link.repoId}`}
                </span>
                {link.status === 'missing' && (
                  <Badge variant="warning" data-testid="settings-link-missing">
                    {t('folders.missing')}
                  </Badge>
                )}
                {link.accessStatus === 'unavailable' && (
                  <Badge
                    variant="warning"
                    title={tl('unavailableHint')}
                    data-testid="settings-link-unavailable"
                  >
                    {tl('unavailable')}
                  </Badge>
                )}
              </span>
              <span
                className="truncate font-mono text-xs text-fg-muted"
                title={link.path}
                data-testid="settings-link-path"
              >
                {link.path}
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => void relink(link)}
              aria-label={t('folders.relinkLabel', { path: link.path })}
              data-testid={`settings-link-${link.id}-relink`}
            >
              <FolderSync aria-hidden />
              {t('folders.relink')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setUnlinkTarget(link)}
              aria-label={t('folders.unlinkLabel', { path: link.path })}
              data-testid={`settings-link-${link.id}-unlink`}
            >
              {t('folders.unlink')}
            </Button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <SettingsSection
      id="folders"
      title={t('folders.title')}
      actions={
        <Button
          size="sm"
          disabled={scanning}
          onClick={() => void rescan()}
          data-testid="settings-rescan"
        >
          <RefreshCw aria-hidden className={scanning ? 'animate-spin' : undefined} />
          {scanning ? t('folders.rescanning') : t('folders.rescan')}
        </Button>
      }
    >
      <p className="px-4 py-2 text-xs text-fg-muted">{t('folders.hint')}</p>
      {notice?.kind === 'scan' && (
        <p
          role="status"
          className="border-t border-border px-4 py-2 text-xs text-fg-muted"
          data-testid="settings-rescan-summary"
        >
          {t('folders.rescanSummary', { ...notice.summary })}
        </p>
      )}
      {notice?.kind === 'error' && (
        <p
          role="alert"
          className="border-t border-border px-4 py-2 text-xs text-danger"
          data-testid="settings-links-error"
        >
          {notice.message}
        </p>
      )}
      {body}
      <ConfirmDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null)
        }}
        title={t('folders.unlinkTitle')}
        description={t('folders.unlinkDescription', { path: unlinkTarget?.path ?? '' })}
        cancelLabel={t('folders.cancel')}
        confirmLabel={t('folders.confirmUnlink')}
        onConfirm={unlink}
        testId="settings-unlink-confirm"
      />
    </SettingsSection>
  )
}
