import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  Check,
  CircleDot,
  GitCommitHorizontal,
  GitPullRequest,
  Inbox,
  MessagesSquare,
  ShieldAlert,
  Tag
} from 'lucide-react'
import type { ActionResult } from '@shared/domain/actions'
import type { NotificationRow } from '@shared/domain/notification'
import '@shared/ipc/actions'
import '@shared/ipc/queries'
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  ExternalLink,
  ListRow,
  PageHeader,
  RelativeTime,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  openExternal
} from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { invoke, useIpcQuery } from '@renderer/lib/ipc'
import {
  DEFAULT_FILTER,
  fallbackReasonLabel,
  filterItems,
  normalizeFilter,
  openInboxItem,
  reasonLabelKey,
  reasonOptions,
  repoOptions,
  subjectKind,
  type InboxFilter,
  type SubjectKind
} from './inbox-logic'
import { useActionAvailability } from '@renderer/lib/hooks/useActionAvailability'

export const GITHUB_NOTIFICATIONS_URL = 'https://github.com/notifications'

const SUBJECT_ICONS: Record<SubjectKind, typeof Bell> = {
  pull: GitPullRequest,
  issue: CircleDot,
  release: Tag,
  discussion: MessagesSquare,
  commit: GitCommitHorizontal,
  other: Bell
}

const selectClass = cn(
  'h-6 rounded-md border border-border bg-bg-subtle px-1.5 text-xs text-fg',
  'hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
)

type Translate = ReturnType<typeof useTranslation>['t']

function useReasonLabel(): (reason: string) => string {
  const { t } = useTranslation('inbox')
  return (reason) => {
    const key = reasonLabelKey(reason)
    return key ? t(key) : fallbackReasonLabel(reason)
  }
}

/** 실패한 쓰기 결과를 화면 문구로 바꾼다 */
function resultMessage(
  t: Translate,
  kind: 'markRead' | 'markDone',
  result: Exclude<ActionResult, { ok: true }>
): string {
  if (result.reason === 'failed') return t(`error.${kind}`, { message: result.message })
  return t(`blocked.${result.reason}`)
}

export function InboxPage() {
  const { t } = useTranslation('inbox')
  const query = useIpcQuery('query:inbox', {})
  const availability = useActionAvailability()
  const [filter, setFilter] = useState<InboxFilter>(DEFAULT_FILTER)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())

  const setError = (threadId: string, message: string | null): void => {
    setErrors((prev) => {
      if (message === null) {
        if (!(threadId in prev)) return prev
        const next = { ...prev }
        delete next[threadId]
        return next
      }
      return { ...prev, [threadId]: message }
    })
  }

  const setPendingFor = (threadId: string, on: boolean): void => {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(threadId)
      else next.delete(threadId)
      return next
    })
  }

  const handleOpen = async (item: NotificationRow): Promise<void> => {
    setError(item.threadId, null)
    try {
      const result = await openInboxItem(item, availability, {
        openExternal,
        markRead: (threadId) => invoke('actions:markRead', { threadId })
      })
      if (result && !result.ok) setError(item.threadId, resultMessage(t, 'markRead', result))
    } catch {
      setError(item.threadId, t('error.open'))
    }
  }

  const handleDone = async (item: NotificationRow): Promise<void> => {
    setError(item.threadId, null)
    setPendingFor(item.threadId, true)
    try {
      const result = await invoke('actions:markDone', { threadId: item.threadId })
      if (!result.ok) setError(item.threadId, resultMessage(t, 'markDone', result))
    } catch {
      setError(item.threadId, t('error.markDone', { message: t('error.unexpected') }))
    } finally {
      setPendingFor(item.threadId, false)
    }
  }

  const data = query.data
  const items = data?.items ?? []
  const effective = normalizeFilter(filter, items)
  const visible = filterItems(items, effective)
  const unreadCount = items.filter((i) => i.state === 'unread').length
  const inboxAvailable = data?.inboxAvailable !== false
  const canWrite = availability?.available === true

  let body: ReactNode
  if (query.isPending) {
    body = (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  } else if (query.isError || !data) {
    body = <ErrorState message={t('error.load')} onRetry={() => void query.refetch()} />
  } else if (!inboxAvailable) {
    body = (
      <div data-testid="inbox-unavailable">
        <EmptyState
          icon={<ShieldAlert />}
          title={t('unavailableInbox.title')}
          description={t('unavailableInbox.description')}
        />
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <FilterBar
          items={items}
          filter={effective}
          onChange={(next) => setFilter({ ...effective, ...next })}
        />
        {availability && !availability.available && (
          <p className="text-xs text-fg-muted" role="status" data-testid="inbox-blocked-hint">
            {t(`blocked.${availability.reason}`)}
          </p>
        )}
        <div
          className="overflow-hidden rounded-lg border border-border bg-bg-elevated"
          role="list"
          aria-label={t('list')}
        >
          {visible.length === 0 ? (
            <div data-testid="inbox-empty">
              <EmptyState
                icon={<Inbox />}
                title={t('empty.title')}
                description={items.length === 0 ? t('empty.description') : t('empty.filtered')}
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((item) => (
                <InboxRow
                  key={item.threadId}
                  item={item}
                  canWrite={canWrite}
                  busy={pending.has(item.threadId)}
                  error={errors[item.threadId]}
                  onOpen={() => void handleOpen(item)}
                  onDone={() => void handleDone(item)}
                  onDismissError={() => setError(item.threadId, null)}
                />
              ))}
            </div>
          )}
        </div>
        {!data.complete && (
          <p className="flex items-center gap-1.5 text-xs text-fg-muted" data-testid="inbox-more">
            {t('incomplete')}
            <ExternalLink href={GITHUB_NOTIFICATIONS_URL} showIcon>
              {t('moreOnGitHub')}
            </ExternalLink>
          </p>
        )}
      </div>
    )
  }

  return (
    <Tabs
      value={effective.unreadOnly ? 'unread' : 'all'}
      onValueChange={(value) => setFilter({ ...effective, unreadOnly: value === 'unread' })}
    >
      <PageHeader
        breadcrumb={[{ label: t('title'), icon: <Inbox size={14} aria-hidden /> }]}
        tabs={
          inboxAvailable && data ? (
            <TabsList aria-label={t('filter.label')}>
              <TabsTrigger value="all" data-testid="inbox-filter-all">
                {t('filter.all')}
                <span className="text-xs text-fg-muted tabular-nums">{items.length}</span>
              </TabsTrigger>
              <TabsTrigger value="unread" data-testid="inbox-filter-unread">
                {t('filter.unread')}
                <span className="text-xs text-fg-muted tabular-nums">{unreadCount}</span>
              </TabsTrigger>
            </TabsList>
          ) : undefined
        }
      />
      <section className="mx-auto max-w-5xl p-6" data-testid="inbox-page">
        {body}
      </section>
    </Tabs>
  )
}

interface FilterBarProps {
  items: readonly NotificationRow[]
  filter: InboxFilter
  onChange: (next: Partial<InboxFilter>) => void
}

function FilterBar({ items, filter, onChange }: FilterBarProps) {
  const { t } = useTranslation('inbox')
  const reasonLabel = useReasonLabel()
  const repos = repoOptions(items)
  const reasons = reasonOptions(items)
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t('filter.label')} role="group">
      <select
        className={selectClass}
        aria-label={t('filter.repo')}
        data-testid="inbox-filter-repo"
        value={filter.repo}
        onChange={(e) => onChange({ repo: e.target.value })}
      >
        <option value="">{t('filter.allRepos')}</option>
        {repos.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        aria-label={t('filter.reason')}
        data-testid="inbox-filter-reason"
        value={filter.reason}
        onChange={(e) => onChange({ reason: e.target.value })}
      >
        <option value="">{t('filter.allReasons')}</option>
        {reasons.map((reason) => (
          <option key={reason} value={reason}>
            {reasonLabel(reason)}
          </option>
        ))}
      </select>
    </div>
  )
}

interface InboxRowProps {
  item: NotificationRow
  canWrite: boolean
  busy: boolean
  error: string | undefined
  onOpen: () => void
  onDone: () => void
  onDismissError: () => void
}

function InboxRow({ item, canWrite, busy, error, onOpen, onDone, onDismissError }: InboxRowProps) {
  const { t } = useTranslation('inbox')
  const reasonLabel = useReasonLabel()
  const unread = item.state === 'unread'
  const kind = subjectKind(item.subjectType)
  const Icon = SUBJECT_ICONS[kind]
  return (
    <div role="listitem" data-testid={`inbox-row-${item.threadId}`} data-state={item.state}>
      <ListRow
        className={cn(unread ? 'font-medium text-fg' : 'text-fg-muted')}
        icon={
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                unread ? 'bg-accent' : 'bg-transparent'
              )}
              aria-hidden
            />
            {unread && <span className="sr-only">{t('unread')}</span>}
            <Icon
              size={15}
              role="img"
              aria-label={t(`subject.${kind}`)}
              className={unread ? 'text-fg' : 'text-fg-subtle'}
            />
          </span>
        }
        title={item.subjectTitle}
        selectLabel={unread ? t('unreadLabel', { title: item.subjectTitle }) : item.subjectTitle}
        meta={
          <span className="font-normal">
            <span className={cn(unread && 'text-fg-muted')}>{item.repoFullName}</span>
            <span aria-hidden className="mx-1.5 text-fg-subtle">
              ·
            </span>
            <span>{reasonLabel(item.reason)}</span>
          </span>
        }
        right={
          <>
            <RelativeTime date={item.updatedAt} className="font-normal tabular-nums" />
            <Button
              size="sm"
              variant="ghost"
              disabled={!canWrite || busy}
              onClick={onDone}
              aria-label={t('doneLabel', { title: item.subjectTitle })}
              data-testid={`inbox-done-${item.threadId}`}
            >
              <Check />
              {t('done')}
            </Button>
          </>
        }
        onSelect={onOpen}
      />
      {error && (
        <div data-testid={`inbox-error-${item.threadId}`}>
          <Banner variant="error" className="border-x-0 border-b-0" onDismiss={onDismissError}>
            {error}
          </Banner>
        </div>
      )}
    </div>
  )
}
