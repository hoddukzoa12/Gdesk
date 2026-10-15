import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Download,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Link2,
  SquareCode,
  SquareTerminal,
  X
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { LocalLink } from '@shared/domain/link'
import type { OpenOutcome, OpenTarget } from '@shared/domain/local'
import { usePlatform } from '@renderer/app/platform'
import { Badge, Button } from '@renderer/components'
import { useSettings } from '@renderer/lib/hooks/useSettings'
import { invoke, useIpcQuery } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import {
  fileManagerKey,
  httpsCloneUrl,
  linkFailureKey,
  menuMode,
  openFailureKey,
  pickLink,
  sshCloneUrl
} from './clone-logic'
import { writeClipboardText } from './clipboard'
import { useRefreshLinks, useRepoLinks } from './hooks'
import { requestClone } from './store'

const itemClass = cn(
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-fg outline-none select-none',
  'data-[highlighted]:bg-bg-hover data-[disabled]:opacity-50',
  '[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-muted'
)
const contentClass =
  'z-50 min-w-[220px] max-w-[360px] rounded-md border border-border bg-bg-elevated p-1 text-fg shadow-xl'
const separatorClass = 'my-1 h-px bg-border'
const labelClass = 'px-2 py-1 text-xs text-fg-muted'

/** 메뉴 아래 한 줄 알림(복사 완료, 열기 실패 등) */
interface MenuMessage {
  kind: 'info' | 'error'
  text: string
  action?: 'relink' | 'settings'
  /** relink 대상 */
  linkId?: number
}

export interface CloneOpenMenuProps {
  repoId: number
  owner: string
  name: string
  className?: string
}

/**
 * 저장소 머리글의 Clone/Open 메뉴(spec §4.9, §4.10, §4.11).
 * 로컬 연결이 없으면 "Clone", 있으면 "Open". 주소 복사·폴더 연결·다시 연결도 여기서 한다.
 */
export function CloneOpenMenu({ repoId, owner, name, className }: CloneOpenMenuProps) {
  const { t } = useTranslation('clone')
  const navigate = useNavigate()
  const linksQuery = useRepoLinks(repoId)
  const refreshLinks = useRefreshLinks()
  const editorsQuery = useIpcQuery('local:listEditors')
  const platform = usePlatform()
  const [menuOpen, setMenuOpen] = useState(false)
  // 설정(기본 편집기). settings:changed 를 따르므로 늘 최신 값이다
  const settings = useSettings().data
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [message, setMessage] = useState<MenuMessage | null>(null)

  const links: LocalLink[] = linksQuery.data ?? []
  const mode = menuMode(links)
  const selected = pickLink(links, selectedId)
  const editors = editorsQuery.data ?? []
  const defaultEditor = editors.find((e) => e.id === settings?.defaultEditor) ?? editors[0]
  const otherEditors = editors.filter((e) => e.id !== defaultEditor?.id)

  // 복사 완료 같은 안내는 잠시 뒤 사라진다
  useEffect(() => {
    if (message?.kind !== 'info') return
    const timer = setTimeout(() => setMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [message])

  const onMenuOpenChange = (open: boolean): void => {
    setMenuOpen(open)
    if (open) {
      void editorsQuery.refetch()
    }
  }

  const copy = useCallback(
    async (url: string): Promise<void> => {
      const ok = await writeClipboardText(url)
      setMessage(
        ok
          ? { kind: 'info', text: t('feedback.copied', { url }) }
          : { kind: 'error', text: t('feedback.copyFailed') }
      )
    },
    [t]
  )

  const open = async (link: LocalLink, target: OpenTarget, editorId?: string): Promise<void> => {
    setMessage(null)
    let res: OpenOutcome
    try {
      res = await invoke('local:open', {
        linkId: link.id,
        target,
        ...(editorId !== undefined ? { editorId } : {})
      })
    } catch {
      res = { ok: false, reason: 'launch_failed' }
    }
    // 최근 사용 순서(또는 missing 표시)가 바뀌었을 수 있다
    refreshLinks()
    if (res.ok) return
    setMessage({
      kind: 'error',
      text: [t(openFailureKey(res.reason)), res.detail].filter(Boolean).join(' '),
      ...(res.reason === 'missing' ? { action: 'relink' as const, linkId: link.id } : {}),
      ...(res.reason === 'no_editor' || res.reason === 'unknown_editor'
        ? { action: 'settings' as const }
        : {})
    })
  }

  const relink = async (linkId: number): Promise<void> => {
    setMessage(null)
    try {
      const chosen = await invoke('dialog:chooseFolder', {})
      if (!chosen.path) return
      const res = await invoke('local:relink', { linkId, path: chosen.path })
      if (res.ok) {
        refreshLinks()
        const link = res.links[0]
        if (link) {
          setSelectedId(link.id)
          setMessage({ kind: 'info', text: t('feedback.relinked', { path: link.path }) })
        }
      } else {
        setMessage({ kind: 'error', text: t(linkFailureKey(res.reason)) })
      }
    } catch {
      setMessage({ kind: 'error', text: t('linkFailure.unresolved') })
    }
  }

  const linkFolder = async (): Promise<void> => {
    setMessage(null)
    try {
      const chosen = await invoke(
        'dialog:chooseFolder',
        settings?.cloneBaseDir ? { defaultPath: settings.cloneBaseDir } : {}
      )
      if (!chosen.path) return
      const res = await invoke('local:link', { repoId, path: chosen.path })
      if (res.ok) {
        refreshLinks()
        const link = res.links.find((l) => l.repoId === repoId) ?? res.links[0]
        if (link) {
          setSelectedId(link.id)
          setMessage({ kind: 'info', text: t('feedback.linked', { path: link.path }) })
        }
      } else {
        setMessage({ kind: 'error', text: t(linkFailureKey(res.reason)) })
      }
    } catch {
      setMessage({ kind: 'error', text: t('linkFailure.unresolved') })
    }
  }

  const startClone = (): void => {
    // 메뉴가 닫히며 포커스를 돌려준 뒤 대화상자를 연다
    setTimeout(() => requestClone({ repoId, owner, name }), 0)
  }

  const label = mode === 'open' ? t('button.open') : t('button.clone')

  return (
    <div className={cn('relative', className)} data-testid="repo-clone-slot">
      <DropdownMenu.Root open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant={mode === 'clone' ? 'primary' : 'default'}
            data-testid="repo-clone-button"
            data-mode={mode}
            data-links={links.length}
            aria-label={t('button.menuLabel', { name: `${owner}/${name}` })}
          >
            {mode === 'open' ? <FolderOpen aria-hidden /> : <Code aria-hidden />}
            {label}
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={contentClass}
            data-testid="clone-menu"
          >
            {mode === 'open' && selected && (
              <>
                {links.length > 1 && (
                  <>
                    <DropdownMenu.Label className={labelClass}>
                      {t('menu.folders')}
                    </DropdownMenu.Label>
                    <DropdownMenu.RadioGroup
                      value={String(selected.id)}
                      onValueChange={(value) => setSelectedId(Number(value))}
                    >
                      {links.map((link) => (
                        <DropdownMenu.RadioItem
                          key={link.id}
                          value={String(link.id)}
                          className={cn(itemClass, 'pl-6 relative')}
                          onSelect={(e) => e.preventDefault()}
                          data-testid={`clone-menu-folder-${link.id}`}
                          data-status={link.status}
                        >
                          <DropdownMenu.ItemIndicator className="absolute left-2 inline-flex">
                            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                          </DropdownMenu.ItemIndicator>
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-xs"
                            title={link.path}
                          >
                            {link.path}
                          </span>
                          {link.status === 'missing' && (
                            <Badge variant="warning">{t('menu.missing')}</Badge>
                          )}
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                    <DropdownMenu.Separator className={separatorClass} />
                  </>
                )}
                {links.length === 1 && (
                  <DropdownMenu.Label
                    className={cn(labelClass, 'truncate font-mono')}
                    title={selected.path}
                    data-testid="clone-menu-path"
                  >
                    {selected.path}
                  </DropdownMenu.Label>
                )}
                {selected.status === 'missing' ? (
                  <>
                    <DropdownMenu.Label className={cn(labelClass, 'text-warning')}>
                      {t('menu.missingHint')}
                    </DropdownMenu.Label>
                    <DropdownMenu.Item
                      className={itemClass}
                      onSelect={() => void relink(selected.id)}
                      data-testid="clone-menu-relink"
                    >
                      <Link2 aria-hidden />
                      {t('menu.relink')}
                    </DropdownMenu.Item>
                  </>
                ) : (
                  <>
                    <DropdownMenu.Item
                      className={itemClass}
                      onSelect={() => void open(selected, 'editor', defaultEditor?.id)}
                      data-testid="clone-menu-open-editor"
                    >
                      <SquareCode aria-hidden />
                      {defaultEditor
                        ? t('menu.openInEditor', { editor: defaultEditor.name })
                        : t('menu.openInDefaultEditor')}
                    </DropdownMenu.Item>
                    {otherEditors.length > 0 && (
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger
                          className={itemClass}
                          data-testid="clone-menu-other-editors"
                        >
                          <SquareCode aria-hidden />
                          <span className="flex-1">{t('menu.otherEditors')}</span>
                          <ChevronRight aria-hidden />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent sideOffset={4} className={contentClass}>
                            {otherEditors.map((editor) => (
                              <DropdownMenu.Item
                                key={editor.id}
                                className={itemClass}
                                onSelect={() => void open(selected, 'editor', editor.id)}
                                data-testid={`clone-menu-editor-${editor.id}`}
                              >
                                {editor.name}
                              </DropdownMenu.Item>
                            ))}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    )}
                    <DropdownMenu.Item
                      className={itemClass}
                      onSelect={() => void open(selected, 'terminal')}
                      data-testid="clone-menu-open-terminal"
                    >
                      <SquareTerminal aria-hidden />
                      {t('menu.openInTerminal')}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={itemClass}
                      onSelect={() => void open(selected, 'fileManager')}
                      data-testid="clone-menu-show-folder"
                    >
                      <FolderSearch aria-hidden />
                      {t(fileManagerKey(platform))}
                    </DropdownMenu.Item>
                  </>
                )}
                <DropdownMenu.Separator className={separatorClass} />
              </>
            )}
            {mode === 'clone' && (
              <>
                <DropdownMenu.Item
                  className={itemClass}
                  onSelect={startClone}
                  data-testid="clone-menu-clone"
                >
                  <Download aria-hidden />
                  {t('menu.clone')}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className={separatorClass} />
              </>
            )}
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => void copy(httpsCloneUrl(owner, name))}
              data-testid="clone-menu-copy-https"
            >
              <Copy aria-hidden />
              {t('menu.copyHttps')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => void copy(sshCloneUrl(owner, name))}
              data-testid="clone-menu-copy-ssh"
            >
              <Copy aria-hidden />
              {t('menu.copySsh')}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={separatorClass} />
            {mode === 'open' && (
              <DropdownMenu.Item
                className={itemClass}
                onSelect={startClone}
                data-testid="clone-menu-clone"
              >
                <Download aria-hidden />
                {t('menu.cloneAgain')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => void linkFolder()}
              data-testid="clone-menu-link-folder"
            >
              <FolderPlus aria-hidden />
              {t('menu.linkFolder')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {message && (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          data-testid="clone-menu-message"
          data-kind={message.kind}
          className={cn(
            'absolute top-full right-0 z-40 mt-1.5 flex w-80 items-start gap-2 rounded-md border bg-bg-elevated p-2 text-xs shadow-lg',
            message.kind === 'error' ? 'border-danger/40 text-fg' : 'border-border text-fg-muted'
          )}
        >
          <span className="min-w-0 flex-1 break-all">{message.text}</span>
          {message.action === 'relink' && message.linkId !== undefined && (
            <Button
              size="sm"
              onClick={() => void relink(message.linkId as number)}
              data-testid="clone-menu-message-relink"
            >
              {t('menu.relink')}
            </Button>
          )}
          {message.action === 'settings' && (
            <Button size="sm" onClick={() => void navigate('/settings')}>
              {t('feedback.openSettings')}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('feedback.dismiss')}
            onClick={() => setMessage(null)}
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  )
}
