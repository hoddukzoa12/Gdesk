import { GitBranch, GitFork, Pin, PinOff, Scale, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RepositorySummary } from '@shared/domain/repo'
import { Avatar, Badge, Button, formatRelativeTime, useNow } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { RepoCloneSlot } from './RepoCloneSlot'
import { languageColor } from './repo-detail'

export interface RepoHeaderProps {
  repo: RepositorySummary
  pinned: boolean
  /** 쓰기 동작(스타)을 막는 이유. null 이면 가능 */
  writeBlockedReason: string | null
  starBusy: boolean
  pinBusy: boolean
  onToggleStar: () => void
  onFork: () => void
  onTogglePin: () => void
}

/** 저장소 머리글: 이름 · 공개 여부 · 설명 · 메타 줄 + 스타 · 포크 · 고정 · 클론 */
export function RepoHeader({
  repo,
  pinned,
  writeBlockedReason,
  starBusy,
  pinBusy,
  onToggleStar,
  onFork,
  onTogglePin
}: RepoHeaderProps) {
  const { t, i18n } = useTranslation('repo')
  const now = useNow()
  const nf = new Intl.NumberFormat(i18n.language)
  const updated = repo.pushedAt ?? repo.updatedAt
  const starDisabled = writeBlockedReason !== null || starBusy

  return (
    <header className="flex flex-wrap items-start gap-4">
      <Avatar
        src={repo.ownerAvatarUrl}
        name={repo.owner}
        size={48}
        shape="square"
        className="rounded-xl"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold" data-testid="repo-name">
            {repo.name}
          </h1>
          <Badge variant="outline">
            {repo.private ? t('visibility.private') : t('visibility.public')}
          </Badge>
          {repo.archived && <Badge variant="warning">{t('badges.archived')}</Badge>}
          {repo.fork && <Badge variant="outline">{t('badges.fork')}</Badge>}
        </div>
        {repo.description && (
          <p className="text-[13px] text-fg-muted" data-testid="repo-description">
            {repo.description}
          </p>
        )}
        <dl
          aria-label={t('meta.label')}
          className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted"
        >
          {repo.primaryLanguage && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{t('meta.language')}</dt>
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{
                  backgroundColor: repo.primaryLanguageColor ?? languageColor(repo.primaryLanguage)
                }}
              />
              <dd>{repo.primaryLanguage}</dd>
            </div>
          )}
          {repo.defaultBranch && (
            <div className="flex items-center gap-1">
              <dt className="sr-only">{t('meta.branch')}</dt>
              <GitBranch size={13} aria-hidden />
              <dd className="font-mono">{repo.defaultBranch}</dd>
            </div>
          )}
          {repo.license && (
            <div className="flex items-center gap-1">
              <dt className="sr-only">{t('meta.license')}</dt>
              <Scale size={13} aria-hidden />
              <dd>{repo.license}</dd>
            </div>
          )}
          {updated && (
            <div>
              <dd>
                <time dateTime={updated}>
                  {t('meta.updated', {
                    time: formatRelativeTime(updated, now, i18n.language)
                  })}
                </time>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          data-testid="repo-star-button"
          aria-pressed={repo.viewerHasStarred}
          aria-label={`${repo.viewerHasStarred ? t('actions.starred') : t('actions.star')}, ${t(
            'actions.starCount',
            { n: nf.format(repo.stargazerCount) }
          )}`}
          disabled={starDisabled}
          title={writeBlockedReason ?? undefined}
          onClick={onToggleStar}
        >
          <Star aria-hidden className={cn(repo.viewerHasStarred && 'fill-warning text-warning')} />
          {repo.viewerHasStarred ? t('actions.starred') : t('actions.star')}
          <span className="ml-1 text-fg-muted tabular-nums" data-testid="repo-star-count">
            {nf.format(repo.stargazerCount)}
          </span>
        </Button>
        <Button
          data-testid="repo-fork-button"
          aria-label={`${t('actions.fork')}, ${t('actions.forkCount', {
            n: nf.format(repo.forkCount)
          })}`}
          onClick={onFork}
        >
          <GitFork aria-hidden />
          {t('actions.fork')}
          <span className="ml-1 text-fg-muted tabular-nums">{nf.format(repo.forkCount)}</span>
        </Button>
        <Button
          data-testid="repo-pin-button"
          aria-pressed={pinned}
          disabled={pinBusy}
          onClick={onTogglePin}
        >
          {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          {pinned ? t('actions.unpin') : t('actions.pin')}
        </Button>
        <RepoCloneSlot
          repoId={repo.id}
          owner={repo.owner}
          name={repo.name}
          fullName={repo.fullName}
          url={repo.url}
          defaultBranch={repo.defaultBranch}
          private={repo.private}
        />
      </div>
    </header>
  )
}
