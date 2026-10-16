import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Copy,
  ExternalLink as ExternalLinkIcon,
  MoreHorizontal,
  RotateCcw,
  X
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/issue-actions'
import '@shared/ipc/queries'
import '@shared/ipc/sync'
import type { ActionAvailability } from '@shared/domain/actions'
import type { IssueRow as IssueRowData } from '@shared/domain/issue'
import type { IssueCloseReason } from '@shared/domain/issue-actions'
import type { IssueDetail, IssueRef } from '@shared/domain/issue-detail'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ExternalLink,
  Spinner,
  openExternal
} from '@renderer/components'
import { useActionAvailability } from '@renderer/lib/hooks/useActionAvailability'
import { useSyncStatus } from '@renderer/lib/hooks/useSyncStatus'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { writeClipboardText } from '../clone/clipboard'
import { CommentComposer } from './CommentComposer'
import { LabelChip, useAgo } from './IssueRow'
import { blockedKey, failureMessage, issueKey } from './issues-logic'
import { LinkedItemsBox } from './LinkedItemsBox'
import { ReactionBar } from './ReactionBar'
import { SafeHtml } from './SafeHtml'

const menuItemClass = cn(
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-fg outline-none select-none',
  'data-[highlighted]:bg-bg-hover data-[disabled]:opacity-50',
  '[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-muted'
)
const menuContentClass =
  'z-50 min-w-[200px] rounded-md border border-border bg-bg-elevated p-1 text-fg shadow-xl'

export interface IssueDetailPanelProps {
  /** 연 이슈. null 이면 "이슈를 선택하세요" */
  issueRef: IssueRef | null
  /** 목록에 같은 이슈가 있으면 그 행(불러오는 동안 제목을 먼저 보인다) */
  row: IssueRowData | null
  onClose: () => void
}

/**
 * 오른쪽 상세 패널(spec §6.2). 열린 이슈를 `sync:setViewedIssue` 로 알려 메인이 받게 하고,
 * 받은 값은 `query:issueDetail` 로 읽는다(data:changed 로 다시 읽힌다). 언마운트 때 null 을 보낸다.
 */
export function IssueDetailPanel({ issueRef, row, onClose }: IssueDetailPanelProps) {
  const { t } = useTranslation('issues')
  const repoId = issueRef?.repoId ?? null
  const number = issueRef?.number ?? null

  useEffect(() => {
    const ref = repoId !== null && number !== null ? { repoId, number } : null
    void invoke('sync:setViewedIssue', ref).catch(() => undefined)
  }, [repoId, number])
  useEffect(
    () => () => {
      void invoke('sync:setViewedIssue', null).catch(() => undefined)
    },
    []
  )

  if (repoId === null || number === null) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="issue-panel-empty">
        <EmptyState
          icon={<CircleDot />}
          title={t('detail.selectTitle')}
          description={t('detail.selectDescription')}
        />
      </div>
    )
  }
  return (
    <PanelLoader
      key={`${repoId}-${number}`}
      issueRef={{ repoId, number }}
      row={row}
      onClose={onClose}
    />
  )
}

function PanelLoader({
  issueRef,
  row,
  onClose
}: {
  issueRef: IssueRef
  row: IssueRowData | null
  onClose: () => void
}) {
  const { t } = useTranslation('issues')
  const sync = useSyncStatus()
  const query = useQuery({
    queryKey: ['query:issueDetail', { repoId: issueRef.repoId, number: issueRef.number }],
    queryFn: () => invoke('query:issueDetail', { repoId: issueRef.repoId, number: issueRef.number })
  })
  const detail = query.data ?? null

  if (detail) return <PanelBody detail={detail} onClose={onClose} />

  const connection = sync?.connection
  const unreachable =
    query.isError || (query.isSuccess && connection !== undefined && connection !== 'online')
  return (
    <div className="flex h-full flex-col" data-testid="issue-panel" data-issue={issueKey(issueRef)}>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">
          {row ? `${row.repoFullName}#${row.number} ${row.title}` : `#${issueRef.number}`}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('detail.close')}
          onClick={onClose}
          data-testid="issue-panel-close"
        >
          <X />
        </Button>
      </div>
      {unreachable ? (
        <div data-testid="issue-detail-unavailable" data-connection={connection}>
          <EmptyState
            title={
              connection === 'offline' ? t('detail.offlineTitle') : t('detail.unavailableTitle')
            }
            description={t('detail.unavailableDescription')}
            action={
              row ? (
                <ExternalLink href={row.url} showIcon className="text-accent">
                  {t('detail.openOnGitHub')}
                </ExternalLink>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="flex justify-center py-12" data-testid="issue-detail-loading">
          <Spinner />
        </div>
      )}
    </div>
  )
}

/** 상태 배지: Open / Closed(완료·계획 없음·중복) */
function StateBadge({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation('issues')
  if (detail.state === 'open') {
    return (
      <Badge
        variant="success"
        className="h-6 px-2 text-xs"
        data-testid="issue-state"
        data-state="open"
      >
        <CircleDot size={12} aria-hidden />
        {t('state.open')}
      </Badge>
    )
  }
  const reason = detail.stateReason
  return (
    <Badge
      className={cn(
        'h-6 border-transparent px-2 text-xs',
        reason === 'completed' || reason === null
          ? 'bg-merged/15 text-merged'
          : 'bg-bg-subtle text-fg-muted'
      )}
      data-testid="issue-state"
      data-state="closed"
      data-state-reason={reason ?? undefined}
    >
      {reason === 'not_planned' || reason === 'duplicate' ? (
        <CircleSlash size={12} aria-hidden />
      ) : (
        <CircleCheck size={12} aria-hidden />
      )}
      {reason
        ? t('state.closedWithReason', { reason: t(`state.reason.${reason}`) })
        : t('state.closed')}
    </Badge>
  )
}

function writeBlocked(availability: ActionAvailability | undefined): string | null {
  if (!availability) return 'loading'
  return availability.available ? null : availability.reason
}

function PanelBody({ detail, onClose }: { detail: IssueDetail; onClose: () => void }) {
  const { t } = useTranslation('issues')
  const availability = useActionAvailability()
  const blocked = writeBlocked(availability)
  const writesDisabled = blocked !== null
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [changingState, setChangingState] = useState(false)
  const opened = useAgo(detail.createdAt)
  const ref: IssueRef = { repoId: detail.repoId, number: detail.number }

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const setState = async (state: 'open' | 'closed', reason?: IssueCloseReason): Promise<void> => {
    if (changingState || writesDisabled) return
    setChangingState(true)
    setActionError(null)
    try {
      const res = await invoke('issueActions:setState', {
        issueRef: ref,
        state,
        ...(reason ? { reason } : {})
      })
      if (!res.ok) setActionError(failureMessage(res, t))
    } catch {
      setActionError(t('failure.failed'))
    } finally {
      setChangingState(false)
    }
  }

  const copyLink = async (): Promise<void> => {
    const ok = await writeClipboardText(detail.url)
    setNotice(ok ? t('detail.linkCopied') : t('detail.copyFailed'))
  }

  const canClose = detail.state === 'open' && detail.viewerCanClose
  const canReopen = detail.state === 'closed' && detail.viewerCanReopen
  const stateDisabled = writesDisabled || changingState

  const stateButton = canClose ? (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button disabled={stateDisabled} data-testid="issue-close-button">
          <CircleCheck />
          {t('actions.close')}
          <ChevronDown />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass}>
          <DropdownMenu.Label className="px-2 py-1 text-xs text-fg-muted">
            {t('actions.closeReasonLabel')}
          </DropdownMenu.Label>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() => void setState('closed', 'completed')}
            data-testid="issue-close-completed"
          >
            <CircleCheck />
            {t('actions.closeCompleted')}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() => void setState('closed', 'not_planned')}
            data-testid="issue-close-not_planned"
          >
            <CircleSlash />
            {t('actions.closeNotPlanned')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ) : canReopen ? (
    <Button
      disabled={stateDisabled}
      onClick={() => void setState('open')}
      data-testid="issue-reopen-button"
    >
      <RotateCcw />
      {t('actions.reopen')}
    </Button>
  ) : null

  return (
    <article
      className="flex min-h-full flex-col"
      data-testid="issue-panel"
      data-issue={issueKey(ref)}
      aria-label={detail.title}
    >
      {/* 머리: 상태 · 번호 · 연 시각 · … 메뉴 */}
      <header className="flex flex-col gap-3 border-b border-border px-5 pt-4 pb-4">
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <StateBadge detail={detail} />
          <span className="min-w-0 truncate" data-testid="issue-opened">
            {t('detail.opened', {
              number: detail.number,
              time: opened,
              author: detail.author.login
            })}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('detail.menu')}
                  data-testid="issue-menu"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass}>
                  <DropdownMenu.Item
                    className={menuItemClass}
                    onSelect={() => void openExternal(detail.url)}
                    data-testid="issue-menu-open"
                  >
                    <ExternalLinkIcon />
                    {t('detail.openOnGitHub')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={menuItemClass}
                    onSelect={() => void copyLink()}
                    data-testid="issue-menu-copy"
                  >
                    <Copy />
                    {t('detail.copyLink')}
                  </DropdownMenu.Item>
                  {(canClose || canReopen) && (
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  )}
                  {canClose && (
                    <>
                      <DropdownMenu.Item
                        className={menuItemClass}
                        disabled={stateDisabled}
                        onSelect={() => void setState('closed', 'completed')}
                        data-testid="issue-menu-close-completed"
                      >
                        <CircleCheck />
                        {t('actions.closeCompleted')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={menuItemClass}
                        disabled={stateDisabled}
                        onSelect={() => void setState('closed', 'not_planned')}
                        data-testid="issue-menu-close-not_planned"
                      >
                        <CircleSlash />
                        {t('actions.closeNotPlanned')}
                      </DropdownMenu.Item>
                    </>
                  )}
                  {canReopen && (
                    <DropdownMenu.Item
                      className={menuItemClass}
                      disabled={stateDisabled}
                      onSelect={() => void setState('open')}
                      data-testid="issue-menu-reopen"
                    >
                      <RotateCcw />
                      {t('actions.reopen')}
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('detail.close')}
              onClick={onClose}
              data-testid="issue-panel-close"
            >
              <X />
            </Button>
          </div>
        </div>
        <h2 className="text-lg leading-snug font-semibold text-fg" data-testid="issue-title">
          {detail.title}
        </h2>
        <p className="text-xs text-fg-subtle">{detail.repoFullName}</p>
        {(detail.labels.length > 0 || detail.assignees.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
            {detail.labels.length > 0 && (
              <span
                className="inline-flex flex-wrap items-center gap-1"
                role="list"
                aria-label={t('row.labels')}
                data-testid="issue-labels"
              >
                {detail.labels.map((label) => (
                  <span key={label.name} role="listitem" className="inline-flex">
                    <LabelChip label={label} />
                  </span>
                ))}
              </span>
            )}
            {detail.assignees.length > 0 && (
              <span
                className="inline-flex flex-wrap items-center gap-2"
                role="list"
                aria-label={t('detail.assignees')}
                data-testid="issue-assignees"
              >
                {detail.assignees.map((a) => (
                  <span
                    key={a.login}
                    role="listitem"
                    className="inline-flex items-center gap-1"
                    data-assignee={a.login}
                  >
                    <Avatar src={a.avatarUrl} name={a.login} size={16} />
                    {a.login}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="text-xs text-fg-muted" data-testid="issue-notice">
            {notice}
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-[13px] text-danger" data-testid="issue-action-error">
            {actionError}
          </p>
        )}
        {blocked !== null && blocked !== 'loading' && (
          <p
            className="text-xs text-warning"
            data-testid="issue-blocked-hint"
            data-reason={blocked}
          >
            {t(blockedKey(blocked))}
          </p>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-5 px-5 py-4">
        {/* 본문 */}
        <section className="flex flex-col gap-3">
          {detail.bodyHTML.trim() === '' ? (
            <p className="text-[13px] text-fg-subtle italic">{t('detail.noDescription')}</p>
          ) : (
            <SafeHtml
              html={detail.bodyHTML}
              brokenImageLabel={t('detail.brokenImage')}
              data-testid="issue-body"
            />
          )}
          <ReactionBar
            subjectId={detail.id}
            issueRef={ref}
            reactions={detail.reactions}
            canReact={detail.viewerCanReact}
            disabled={writesDisabled}
            onError={setActionError}
            data-testid="issue-reactions"
          />
        </section>

        <LinkedItemsBox
          pullRequests={detail.linkedPullRequests}
          commits={detail.referencingCommits}
        />

        {/* 댓글 */}
        <section className="flex flex-col gap-3" aria-label={t('detail.comments')}>
          <h3 className="text-[13px] font-semibold text-fg">
            {t('detail.commentsHeading', { count: detail.commentCount })}
          </h3>
          {detail.comments.length > 0 && (
            <ol className="flex flex-col gap-3" data-testid="issue-comments">
              {detail.comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  issueRef={ref}
                  canReact={detail.viewerCanReact}
                  disabled={writesDisabled}
                  onError={setActionError}
                />
              ))}
            </ol>
          )}
          {detail.commentCount > detail.comments.length && (
            <p className="text-xs text-fg-muted" data-testid="issue-comments-more">
              <ExternalLink href={detail.url} showIcon className="text-accent">
                {t('detail.moreComments', { count: detail.commentCount - detail.comments.length })}
              </ExternalLink>
            </p>
          )}
        </section>

        <div className="mt-auto border-t border-border pt-4">
          <CommentComposer
            key={issueKey(ref)}
            issueRef={ref}
            canComment={detail.viewerCanComment}
            disabled={writesDisabled}
            actions={stateButton}
          />
        </div>
      </div>
    </article>
  )
}

function CommentItem({
  comment,
  issueRef,
  canReact,
  disabled,
  onError
}: {
  comment: IssueDetail['comments'][number]
  issueRef: IssueRef
  canReact: boolean
  disabled: boolean
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation('issues')
  const ago = useAgo(comment.createdAt)
  return (
    <li
      className="flex gap-3"
      data-testid={`issue-comment-${comment.id}`}
      data-author={comment.author.login}
    >
      <Avatar
        src={comment.author.avatarUrl}
        name={comment.author.login}
        size={28}
        shape={comment.author.isBot ? 'square' : 'circle'}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">{comment.author.login}</span>
          <time dateTime={comment.createdAt}>{ago}</time>
        </div>
        {comment.bodyHTML.trim() === '' ? (
          <p className="text-[13px] text-fg-subtle italic">{t('detail.noDescription')}</p>
        ) : (
          <SafeHtml html={comment.bodyHTML} brokenImageLabel={t('detail.brokenImage')} />
        )}
        <ReactionBar
          subjectId={comment.id}
          issueRef={issueRef}
          reactions={comment.reactions}
          canReact={canReact}
          disabled={disabled}
          onError={onError}
          data-testid={`comment-reactions-${comment.id}`}
        />
      </div>
    </li>
  )
}
