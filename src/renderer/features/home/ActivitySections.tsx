import type { ReactNode } from 'react'
import {
  BookMarked,
  CodeXml,
  Flame,
  GitFork,
  GitPullRequest,
  GitPullRequestDraft,
  MessageSquare,
  Pin,
  Star
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import '@shared/ipc/pins'
import type {
  ContributionCalendar,
  HomeStats,
  MyPullRequestsSection,
  PinnedRepoCard,
  RecentCommitsSection
} from '@shared/domain/home-activity'
import { Avatar, Badge, RelativeTime, focusRing, openExternal } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { HomeSection, SectionNotice, SectionRow, ViewAllButton } from './HomeSection'
import {
  HEAT_CLASS,
  HEAT_LEGEND,
  HEATMAP_WEEKS,
  PR_PILL_CLASS,
  buildHeatmap,
  firstLine,
  formatStat,
  shortSha
} from './home-logic'

function open(url: string): void {
  void openExternal(url)
}

// ───────────── 수치 ─────────────

function StatTile({
  id,
  icon,
  value,
  label
}: {
  id: keyof HomeStats
  icon: ReactNode
  value: string
  label: string
}) {
  return (
    <div
      className="flex min-w-0 flex-col items-center gap-1 px-3 py-4 text-center"
      data-testid={`home-stat-${id}`}
    >
      <span className="mb-1 text-fg [&_svg]:size-5" aria-hidden>
        {icon}
      </span>
      <span
        className="text-[22px] leading-none font-semibold text-fg tabular-nums"
        data-testid={`home-stat-${id}-value`}
      >
        {value}
      </span>
      <span className="truncate text-xs text-fg-muted">{label}</span>
    </div>
  )
}

/** 수치 줄: 최근 1년 커밋, 저장소, 열린 PR, 연속 기여. 받지 못한 값은 "—" */
export function StatsSection({ stats, className }: { stats: HomeStats; className?: string }) {
  const { t, i18n } = useTranslation('home')
  const nf = new Intl.NumberFormat(i18n.language)
  return (
    <section
      data-testid="home-card-stats"
      aria-label={t('stats.label')}
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-bg-elevated sm:grid-cols-4',
        '[&>*]:border-border sm:[&>*+*]:border-l',
        className
      )}
    >
      <StatTile
        id="commits"
        icon={<CodeXml />}
        value={formatStat(stats.commits, nf)}
        label={t('stats.commits')}
      />
      <StatTile
        id="repositories"
        icon={<BookMarked />}
        value={formatStat(stats.repositories, nf)}
        label={t('stats.repositories')}
      />
      <StatTile
        id="openPullRequests"
        icon={<GitPullRequest />}
        value={formatStat(stats.openPullRequests, nf)}
        label={t('stats.openPullRequests')}
      />
      <StatTile
        id="streak"
        icon={<Flame />}
        value={
          stats.streak == null
            ? formatStat(null, nf)
            : t('stats.streakDays', { count: stats.streak })
        }
        label={t('stats.streak')}
      />
    </section>
  )
}

// ───────────── 고정 저장소 ─────────────

function PinnedCard({ repo }: { repo: PinnedRepoCard }) {
  const { t, i18n } = useTranslation('home')
  const navigate = useNavigate()
  const compact = new Intl.NumberFormat(i18n.language, {
    notation: 'compact',
    maximumFractionDigits: 1
  })
  const name = repo.cached && repo.name ? repo.name : `#${repo.repoId}`
  const fullName = repo.fullName ?? name
  const unavailable = repo.accessStatus === 'unavailable'
  const unpin = (): void => {
    void invoke('pins:unpin', { repoId: repo.repoId })
  }

  return (
    <div
      className="group relative flex min-h-[124px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-bg p-4 transition-colors hover:border-border-strong"
      data-testid={`home-pinned-${repo.repoId}`}
      data-access={repo.accessStatus}
    >
      <button
        type="button"
        aria-label={fullName}
        onClick={() => void navigate(`/repos/${repo.repoId}`)}
        className={cn('absolute inset-0 rounded-[inherit]', focusRing)}
      />
      <div className="flex min-w-0 items-center gap-2.5 pr-6">
        <Avatar
          src={repo.ownerAvatarUrl}
          name={repo.owner ?? name}
          size={24}
          shape="square"
          aria-hidden
        />
        <span className="truncate text-[14px] font-semibold text-fg" title={fullName}>
          {name}
        </span>
        {unavailable && (
          <Badge variant="warning" data-testid={`home-pinned-${repo.repoId}-unavailable`}>
            {t('cards.pinnedRepos.unavailable')}
          </Badge>
        )}
      </div>
      <button
        type="button"
        onClick={unpin}
        title={t('cards.pinnedRepos.unpin')}
        aria-label={t('cards.pinnedRepos.unpinLabel', { name: fullName })}
        data-testid={`home-pinned-${repo.repoId}-unpin`}
        className={cn(
          'absolute top-3 right-3 z-10 inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg',
          focusRing
        )}
      >
        <Pin size={14} aria-hidden />
      </button>
      <p className="line-clamp-2 min-h-[2lh] text-[13px] text-fg-muted">
        {repo.cached ? (repo.description ?? '') : t('cards.pinnedRepos.notLoaded')}
      </p>
      <div className="mt-auto flex min-w-0 items-center gap-4 text-xs text-fg-muted">
        {repo.primaryLanguage && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full bg-fg-subtle"
              style={
                repo.primaryLanguageColor
                  ? { backgroundColor: repo.primaryLanguageColor }
                  : undefined
              }
            />
            <span className="truncate">{repo.primaryLanguage}</span>
          </span>
        )}
        {repo.stargazerCount != null && (
          <span
            className="ml-auto inline-flex items-center gap-1 tabular-nums"
            title={t('cards.pinnedRepos.stars')}
          >
            <Star size={13} aria-hidden />
            {compact.format(repo.stargazerCount)}
          </span>
        )}
        {repo.forkCount != null && (
          <span
            className={cn(
              'inline-flex items-center gap-1 tabular-nums',
              repo.stargazerCount == null && 'ml-auto'
            )}
            title={t('cards.pinnedRepos.forks')}
          >
            <GitFork size={13} aria-hidden />
            {compact.format(repo.forkCount)}
          </span>
        )}
      </div>
    </div>
  )
}

/** 고정 저장소 카드(최대 4, 2×2). 카드는 저장소 상세로, 핀 아이콘은 고정 해제 */
export function PinnedReposSection({
  repos,
  className
}: {
  repos: PinnedRepoCard[]
  className?: string
}) {
  const { t } = useTranslation('home')
  return (
    <HomeSection id="pinnedRepos" title={t('cards.pinnedRepos.title')} className={className}>
      {repos.length === 0 ? (
        <SectionNotice testId="home-pinned-empty">{t('cards.pinnedRepos.empty')}</SectionNotice>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 pt-1 pb-3 sm:grid-cols-2">
          {repos.map((repo) => (
            <PinnedCard key={repo.repoId} repo={repo} />
          ))}
        </div>
      )}
    </HomeSection>
  )
}

// ───────────── 기여 달력 ─────────────

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** 최근 12개월 기여 달력: 53주 × 7일(월–일). 받지 않았으면 빈 달력과 안내 */
export function ContributionsSection({
  calendar,
  className
}: {
  calendar: ContributionCalendar | null
  className?: string
}) {
  const { t, i18n } = useTranslation('home')
  const heatmap = buildHeatmap(calendar?.days ?? [])
  const weeks = HEATMAP_WEEKS
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeZone: 'UTC'
  })
  const monthFormat = new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' })
  const utc = (date: string): Date => new Date(`${date}T00:00:00Z`)

  const placeholders: ReactNode[] = []
  if (!calendar) {
    for (let col = 0; col < weeks; col++) {
      for (let row = 0; row < 7; row++) {
        placeholders.push(
          <span
            key={`${col}-${row}`}
            className={cn('aspect-square rounded-[2px]', HEAT_CLASS.NONE)}
            style={{ gridColumn: col + 2, gridRow: row + 1 }}
          />
        )
      }
    }
  }

  return (
    <HomeSection id="contributions" title={t('cards.contributions.title')} className={className}>
      <div className="flex flex-col gap-3 px-5 pt-1 pb-3">
        {!calendar && (
          <p className="text-[13px] text-fg-muted" data-testid="home-heatmap-empty">
            {t('cards.contributions.notLoaded')}
          </p>
        )}
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `auto repeat(${weeks}, minmax(0, 1fr))` }}
          data-testid="home-heatmap"
          role="img"
          aria-label={t('cards.contributions.title')}
        >
          {DAY_KEYS.map((key, row) => (
            <span
              key={key}
              className="self-center pr-2 text-[10px] leading-none text-fg-muted"
              style={{ gridColumn: 1, gridRow: row + 1 }}
            >
              {t(`cards.contributions.days.${key}`)}
            </span>
          ))}
          {heatmap.cells.map((cell) => (
            <span
              key={cell.date}
              title={t('cards.contributions.cell', {
                date: dateFormat.format(utc(cell.date)),
                count: cell.count
              })}
              data-testid="home-heat-cell"
              data-date={cell.date}
              data-level={cell.level}
              data-row={cell.row}
              data-col={cell.col}
              className={cn(
                'aspect-square rounded-[2px] hover:ring-1 hover:ring-fg-muted',
                HEAT_CLASS[cell.level]
              )}
              style={{ gridColumn: cell.col + 2, gridRow: cell.row + 1 }}
            />
          ))}
          {placeholders}
          {heatmap.months.map((m) => (
            <span
              key={m.date}
              className="pt-1 text-[10px] leading-none whitespace-nowrap text-fg-muted"
              style={{ gridColumn: `${m.col + 2} / span 3`, gridRow: 8 }}
            >
              {monthFormat.format(utc(m.date))}
            </span>
          ))}
        </div>
        <div
          className="flex items-center justify-end gap-1 text-[11px] text-fg-muted"
          data-testid="home-heatmap-legend"
        >
          <span className="mr-1">{t('cards.contributions.less')}</span>
          {HEAT_LEGEND.map((cls) => (
            <span key={cls} aria-hidden className={cn('size-2.5 rounded-[2px]', cls)} />
          ))}
          <span className="ml-1">{t('cards.contributions.more')}</span>
        </div>
      </div>
    </HomeSection>
  )
}

// ───────────── 최근 커밋 ─────────────

/** 내 최근 커밋 5개. 줄은 GitHub 커밋 페이지, "모두 보기"는 GitHub 커밋 검색 */
export function RecentCommitsCard({
  data,
  className
}: {
  data: RecentCommitsSection
  className?: string
}) {
  const { t } = useTranslation('home')
  const viewAllUrl = data.viewAllUrl
  return (
    <HomeSection
      id="recentCommits"
      title={t('cards.recentCommits.title')}
      className={className}
      actions={
        viewAllUrl ? (
          <ViewAllButton
            onClick={() => open(viewAllUrl)}
            testId="home-card-recentCommits-view-all"
          />
        ) : undefined
      }
    >
      {!data.fetched ? (
        <SectionNotice>{t('cards.recentCommits.notLoaded')}</SectionNotice>
      ) : data.items.length === 0 ? (
        <SectionNotice testId="home-recent-commits-empty">
          {t('cards.recentCommits.empty')}
        </SectionNotice>
      ) : (
        data.items.map((commit) => {
          const message = firstLine(commit.message)
          return (
            <SectionRow
              key={`${commit.repoFullName}@${commit.sha}`}
              testId={`home-commit-${commit.sha}`}
              icon={
                <Avatar
                  src={commit.authorAvatarUrl}
                  name={commit.authorLogin ?? commit.repoFullName}
                  size={28}
                  aria-hidden
                />
              }
              title={message}
              meta={
                <>
                  {commit.repoFullName}
                  {commit.authorDate && (
                    <>
                      {' · '}
                      <RelativeTime date={commit.authorDate} style="long" />
                    </>
                  )}
                </>
              }
              right={<span className="font-mono text-xs">{shortSha(commit.sha)}</span>}
              onSelect={() => open(commit.url)}
              label={`${commit.repoFullName} ${shortSha(commit.sha)} ${message}`}
            />
          )
        })
      )}
    </HomeSection>
  )
}

// ───────────── 내 PR ─────────────

/** 내 열린 PR 5개와 전체 수. 상태 알약: 초안·변경 요청·승인·리뷰 필요·열림 */
export function MyPullRequestsCard({
  data,
  className
}: {
  data: MyPullRequestsSection
  className?: string
}) {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  return (
    <HomeSection
      id="myPullRequests"
      title={t('cards.myPullRequests.title')}
      count={data.totalCount}
      className={className}
      actions={
        <ViewAllButton
          onClick={() => void navigate('/pulls?tab=mine')}
          testId="home-card-myPullRequests-view-all"
        />
      }
    >
      {data.items.length === 0 ? (
        <SectionNotice>{t('cards.myPullRequests.empty')}</SectionNotice>
      ) : (
        data.items.map((pr) => {
          const ref = `#${pr.number}`
          const testId = `home-pr-${pr.repoId}-${pr.number}`
          return (
            <SectionRow
              key={pr.id}
              testId={testId}
              icon={
                pr.displayStatus === 'draft' ? (
                  <GitPullRequestDraft size={18} aria-hidden />
                ) : (
                  <GitPullRequest size={18} aria-hidden className="text-success" />
                )
              }
              title={pr.title}
              meta={
                <>
                  {ref} · {pr.repoFullName}
                </>
              }
              right={
                <>
                  <span
                    className="inline-flex items-center gap-1 tabular-nums"
                    title={t('cards.myPullRequests.comments', { count: pr.commentCount })}
                  >
                    <MessageSquare size={14} aria-hidden />
                    {pr.commentCount}
                  </span>
                  <Badge
                    className={cn('h-5 px-2', PR_PILL_CLASS[pr.displayStatus])}
                    data-testid={`${testId}-status`}
                    data-status={pr.displayStatus}
                  >
                    {t(`cards.myPullRequests.status.${pr.displayStatus}`)}
                  </Badge>
                </>
              }
              onSelect={() => open(pr.url)}
              label={`${pr.repoFullName}${ref} ${pr.title}`}
            />
          )
        })
      )}
    </HomeSection>
  )
}
