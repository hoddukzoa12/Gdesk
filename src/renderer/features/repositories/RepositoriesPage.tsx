import { useCallback, useDeferredValue, useState } from 'react'
import { BookMarked, Pin, Search, Star } from 'lucide-react'
import { useNavigate } from 'react-router'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Pin as PinEntry } from '@shared/domain/pin'
import type { RepoSort, RepositorySummary } from '@shared/domain/repo'
import '@shared/ipc/pins'
import '@shared/ipc/queries'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  PageHeader,
  RelativeTime,
  Spinner
} from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { invoke, useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

const SORTS: readonly RepoSort[] = ['pushed', 'name', 'stars']

const controlClass =
  'h-7 rounded-md border border-border bg-bg-subtle px-2 text-[13px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** 고정 목록: 한 번 읽고 `pins:changed` 로 맞춘다. */
function usePinnedIds(): Set<number> {
  const client = useQueryClient()
  const { data } = useIpcQuery('pins:list')
  const onPins = useCallback(
    ({ pins }: { pins: PinEntry[] }) => client.setQueryData(['pins:list'], pins),
    [client]
  )
  useIpcEvent('pins:changed', onPins)
  return new Set((data ?? []).map((p) => p.repoId))
}

/** Repositories 화면 (spec §4.8): 내 저장소 전체. 검색·정렬·소유자·포크·보관 필터, 고정 토글. */
export function RepositoriesPage() {
  const { t } = useTranslation('repositories')
  const navigate = useNavigate()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<RepoSort>('pushed')
  const [owner, setOwner] = useState('')
  const [includeForks, setIncludeForks] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const deferredSearch = useDeferredValue(search.trim())

  const req = {
    includeForks,
    includeArchived,
    sort,
    ...(owner ? { owner } : {}),
    ...(deferredSearch ? { search: deferredSearch } : {})
  }
  // 필터를 바꿀 때 목록이 깜빡이지 않게 이전 결과를 잠시 둔다. 키 앞부분이 채널이라 data:changed 로 다시 읽힌다
  const query = useQuery({
    queryKey: ['query:repositories', req],
    queryFn: () => invoke('query:repositories', req),
    placeholderData: keepPreviousData
  })
  const pinnedIds = usePinnedIds()

  const togglePin = (repo: RepositorySummary) => {
    const channel = pinnedIds.has(repo.id) ? 'pins:unpin' : 'pins:pin'
    void invoke(channel, { repoId: repo.id })
      .then((pins) => client.setQueryData(['pins:list'], pins))
      .catch(() => client.invalidateQueries({ queryKey: ['pins:list'] }))
  }

  const owners = query.data?.owners ?? []
  const items = query.data?.items ?? []
  const filtered =
    deferredSearch !== '' || owner !== '' || includeForks || includeArchived || sort !== 'pushed'

  return (
    <section className="flex flex-col" data-testid="repositories-page">
      <PageHeader breadcrumb={[{ label: t('title') }]} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <label className="relative flex min-w-48 flex-1 items-center">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute left-2 text-fg-subtle"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
            className={cn(controlClass, 'w-full pl-7')}
            data-testid="repositories-search"
          />
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RepoSort)}
          aria-label={t('sort.label')}
          className={controlClass}
          data-testid="repositories-sort"
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label={t('owner.label')}
          className={controlClass}
          data-testid="repositories-owner"
        >
          <option value="">{t('owner.all')}</option>
          {owners.map((o) => (
            <option key={o.login} value={o.login}>
              {t('owner.option', { login: o.login, value: o.count })}
            </option>
          ))}
        </select>
        <Toggle
          checked={includeForks}
          onChange={setIncludeForks}
          label={t('filters.showForks')}
          testId="repositories-show-forks"
        />
        <Toggle
          checked={includeArchived}
          onChange={setIncludeArchived}
          label={t('filters.showArchived')}
          testId="repositories-show-archived"
        />
      </div>

      {query.isPending ? (
        <div className="flex justify-center py-12" data-testid="repositories-loading">
          <Spinner />
        </div>
      ) : query.isError ? (
        <ErrorState message={t('error')} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookMarked />}
          title={filtered ? t('empty.filteredTitle') : t('empty.title')}
          description={filtered ? t('empty.filteredDescription') : t('empty.description')}
        />
      ) : (
        <ul
          className={cn('divide-y divide-border', query.isPlaceholderData && 'opacity-60')}
          aria-label={t('title')}
          aria-busy={query.isPlaceholderData || undefined}
        >
          {items.map((repo) => (
            <li key={repo.id}>
              <RepoRow
                repo={repo}
                pinned={pinnedIds.has(repo.id)}
                onOpen={() => void navigate(`/repos/${repo.id}`)}
                onTogglePin={() => togglePin(repo)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  testId
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  testId: string
}) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-1.5 px-1 text-[13px] text-fg-muted select-none hover:text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-accent"
        data-testid={testId}
      />
      {label}
    </label>
  )
}

function RepoRow({
  repo,
  pinned,
  onOpen,
  onTogglePin
}: {
  repo: RepositorySummary
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
}) {
  const { t, i18n } = useTranslation('repositories')
  const nf = new Intl.NumberFormat(i18n.language)
  const updated = repo.pushedAt ?? repo.updatedAt
  const pinLabel = pinned
    ? t('pin.unpin', { name: repo.fullName })
    : t('pin.pin', { name: repo.fullName })

  return (
    <div data-testid={`repo-row-${repo.id}`} data-pinned={pinned || undefined}>
      <ListRow
        icon={
          <Avatar
            src={repo.ownerAvatarUrl}
            name={repo.owner}
            size={20}
            shape={repo.ownerType === 'Organization' ? 'square' : 'circle'}
          />
        }
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate">
              <span className="text-fg-muted">{repo.owner} / </span>
              <span className="font-medium">{repo.name}</span>
            </span>
            {repo.private && <Badge variant="outline">{t('badges.private')}</Badge>}
            {repo.fork && <Badge variant="outline">{t('badges.fork')}</Badge>}
            {repo.archived && <Badge variant="warning">{t('badges.archived')}</Badge>}
            {repo.accessStatus === 'unavailable' && (
              <Badge variant="danger">{t('badges.unavailable')}</Badge>
            )}
          </span>
        }
        selectLabel={repo.fullName}
        meta={repo.description ?? t('noDescription')}
        onSelect={onOpen}
        right={
          <>
            {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Star size={12} aria-hidden />
              <span className="sr-only">{t('stars')}</span>
              {nf.format(repo.stargazerCount)}
            </span>
            {updated && (
              <span className="hidden sm:inline">
                {t('updated')} <RelativeTime date={updated} />
              </span>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onTogglePin}
              aria-pressed={pinned}
              aria-label={pinLabel}
              title={pinLabel}
              className={cn(pinned && 'text-accent')}
              data-testid={`repo-pin-${repo.id}`}
            >
              <Pin className={cn(pinned && 'fill-current')} />
            </Button>
          </>
        }
      />
    </div>
  )
}
