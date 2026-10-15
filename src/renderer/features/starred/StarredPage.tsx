import { useDeferredValue, useState } from 'react'
import { Search, Star } from 'lucide-react'
import { useNavigate } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { RepositorySummary } from '@shared/domain/repo'
import '@shared/ipc/queries'
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorState,
  ListRow,
  PageHeader,
  RelativeTime,
  Spinner
} from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'

/** Starred 화면 (spec §4.7): 내가 스타한 저장소, 스타한 시각 최신순, 검색. */
export function StarredPage() {
  const { t } = useTranslation('starred')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const req = deferredSearch ? { search: deferredSearch } : {}
  const query = useQuery({
    queryKey: ['query:starred', req],
    queryFn: () => invoke('query:starred', req),
    placeholderData: keepPreviousData
  })
  const items = query.data ?? []

  return (
    <section className="flex flex-col" data-testid="starred-page">
      <PageHeader breadcrumb={[{ label: t('title') }]} />

      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <label className="relative flex flex-1 items-center">
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
            className="h-7 w-full rounded-md border border-border bg-bg-subtle pr-2 pl-7 text-[13px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="starred-search"
          />
        </label>
      </div>

      {query.isPending ? (
        <div className="flex justify-center py-12" data-testid="starred-loading">
          <Spinner />
        </div>
      ) : query.isError ? (
        <ErrorState message={t('error')} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Star />}
          title={deferredSearch ? t('empty.filteredTitle') : t('empty.title')}
          description={deferredSearch ? t('empty.filteredDescription') : t('empty.description')}
        />
      ) : (
        <ul
          className={cn('divide-y divide-border', query.isPlaceholderData && 'opacity-60')}
          aria-label={t('title')}
          aria-busy={query.isPlaceholderData || undefined}
        >
          {items.map((repo) => (
            <li key={repo.id}>
              <StarredRow repo={repo} onOpen={() => void navigate(`/repos/${repo.id}`)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StarredRow({ repo, onOpen }: { repo: RepositorySummary; onOpen: () => void }) {
  const { t, i18n } = useTranslation('starred')
  const nf = new Intl.NumberFormat(i18n.language)
  return (
    <div data-testid={`starred-row-${repo.id}`}>
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
            {repo.starredAt && (
              <span className="hidden sm:inline">
                {t('starredAt')} <RelativeTime date={repo.starredAt} />
              </span>
            )}
          </>
        }
      />
    </div>
  )
}
