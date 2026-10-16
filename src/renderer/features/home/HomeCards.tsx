import type { ReactNode } from 'react'
import { Bell, CircleDot, GitCommitHorizontal, GitPullRequest, Star, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
  Avatar,
  CiStatusIcon,
  EmptyState,
  ListRow,
  MetricCard,
  RelativeTime,
  openExternal
} from '@renderer/components'
import type { CountedList, HomeSummary } from '@shared/domain/home'
import type { HomeTodoCardId } from '@shared/domain/homeCards'
import type { NotificationRow } from '@shared/domain/notification'
import type { PullRequestRow } from '@shared/domain/pr'
import { HomeSection } from './HomeSection'

/** 할 일 카드 줄: 활동 영역 줄과 같은 여백 */
const ROW_CLASS = 'px-5'

function open(url: string): void {
  void openExternal(url)
}

/** 할 일 카드 틀: Home 영역 틀 + "더 있음" 안내. */
function HomeCard({
  id,
  title,
  count,
  subtitle,
  more,
  children
}: {
  id: HomeTodoCardId
  title: ReactNode
  count?: number
  subtitle?: ReactNode
  more?: ReactNode
  children: ReactNode
}) {
  return (
    <HomeSection id={id} title={title} count={count} subtitle={subtitle}>
      {children}
      {more}
    </HomeSection>
  )
}

/**
 * 보여 준 것보다 더 있으면 알린다.
 * - 목록이 완전하고 표시 상한(5개)에만 잘렸으면 중립적인 "+N more"
 * - 근거 목록이 불완전하면(`complete === false`) GitHub 에 더 있을 수 있다고 덧붙인다
 */
function MoreHint({ id, list }: { id: HomeTodoCardId; list: CountedList<unknown> }) {
  const { t } = useTranslation('home')
  const hidden = list.count - list.items.length
  if (hidden <= 0 && list.complete) return null
  let text: string
  if (hidden <= 0) text = t('mayBeMore')
  else if (list.complete) text = t('more', { count: hidden })
  else text = t('moreOnGitHub', { count: hidden })
  return (
    <div className="px-5 py-2 text-xs text-fg-muted" data-testid={`home-card-${id}-more`}>
      {text}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <EmptyState compact title={children} className="px-5" />
}

function repoRef(repoFullName: string, number: number): string {
  return `${repoFullName}#${number}`
}

function PullRequestListRow({ pr, testId }: { pr: PullRequestRow; testId: string }) {
  return (
    <div data-testid={testId}>
      <ListRow
        className={ROW_CLASS}
        icon={<Avatar src={pr.author.avatarUrl} name={pr.author.login} size={20} />}
        title={pr.title}
        meta={
          <>
            {repoRef(pr.repoFullName, pr.number)} · {pr.author.login}
          </>
        }
        right={<RelativeTime date={pr.updatedAt} />}
        onSelect={() => open(pr.url)}
        selectLabel={`${repoRef(pr.repoFullName, pr.number)} ${pr.title}`}
      />
    </div>
  )
}

export function ReviewRequestsCard({ data }: { data: HomeSummary['reviewRequests'] }) {
  const { t } = useTranslation('home')
  return (
    <HomeCard
      id="reviewRequests"
      title={t('cards.reviewRequests.title')}
      count={data.count}
      more={<MoreHint id="reviewRequests" list={data} />}
    >
      {data.items.length === 0 ? (
        <Empty>{t('cards.reviewRequests.empty')}</Empty>
      ) : (
        data.items.map((pr) => (
          <PullRequestListRow
            key={pr.id}
            pr={pr}
            testId={`home-row-reviewRequests-${pr.repoId}-${pr.number}`}
          />
        ))
      )}
    </HomeCard>
  )
}

function notificationIcon(subjectType: string): ReactNode {
  switch (subjectType) {
    case 'PullRequest':
      return <GitPullRequest size={14} aria-hidden />
    case 'Issue':
      return <CircleDot size={14} aria-hidden />
    case 'Release':
      return <Tag size={14} aria-hidden />
    case 'Commit':
      return <GitCommitHorizontal size={14} aria-hidden />
    default:
      return <Bell size={14} aria-hidden />
  }
}

function NotificationListRow({ n }: { n: NotificationRow }) {
  const { t } = useTranslation('home')
  const reason = t(`reason.${n.reason}`, { defaultValue: n.reason })
  return (
    <div data-testid={`home-row-unreadNotifications-${n.threadId}`}>
      <ListRow
        className={ROW_CLASS}
        icon={notificationIcon(n.subjectType)}
        title={n.subjectTitle}
        meta={
          <>
            {n.repoFullName} · {reason}
          </>
        }
        right={<RelativeTime date={n.updatedAt} />}
        onSelect={() => open(n.url)}
        selectLabel={`${n.repoFullName} ${n.subjectTitle}`}
      />
    </div>
  )
}

export function UnreadNotificationsCard({ data }: { data: HomeSummary['unreadNotifications'] }) {
  const { t } = useTranslation('home')
  return (
    <HomeCard
      id="unreadNotifications"
      title={t('cards.unreadNotifications.title')}
      count={data.count}
      more={<MoreHint id="unreadNotifications" list={data} />}
    >
      {data.items.length === 0 ? (
        <Empty>{t('cards.unreadNotifications.empty')}</Empty>
      ) : (
        data.items.map((n) => <NotificationListRow key={n.threadId} n={n} />)
      )}
    </HomeCard>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      {children}
    </div>
  )
}

export function FailedCiCard({ data }: { data: HomeSummary['failedCi'] }) {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  const total = data.repos.length + data.pullRequests.length
  return (
    <HomeCard id="failedCi" title={t('cards.failedCi.title')} count={total}>
      {total === 0 && <Empty>{t('cards.failedCi.empty')}</Empty>}
      {data.repos.length > 0 && <SubHeading>{t('cards.failedCi.repos')}</SubHeading>}
      {data.repos.map((repo) => (
        <div key={repo.repoId} data-testid={`home-row-failedCi-repo-${repo.repoId}`}>
          <ListRow
            className={ROW_CLASS}
            icon={<CiStatusIcon status={repo.ciStatus} />}
            title={repo.repoFullName}
            meta={
              <>
                {repo.defaultBranch ? `${repo.defaultBranch} · ` : ''}
                {repo.sha.slice(0, 7)} {repo.message.split('\n')[0]}
              </>
            }
            right={repo.committedAt ? <RelativeTime date={repo.committedAt} /> : undefined}
            onSelect={() => void navigate(`/repos/${repo.repoId}`)}
            selectLabel={repo.repoFullName}
          />
        </div>
      ))}
      {data.pullRequests.length > 0 && <SubHeading>{t('cards.failedCi.pullRequests')}</SubHeading>}
      {data.pullRequests.map((pr) => (
        <div key={pr.id} data-testid={`home-row-failedCi-pr-${pr.repoId}-${pr.number}`}>
          <ListRow
            className={ROW_CLASS}
            icon={<CiStatusIcon status={pr.ciStatus} />}
            title={pr.title}
            meta={repoRef(pr.repoFullName, pr.number)}
            right={<RelativeTime date={pr.updatedAt} />}
            onSelect={() => open(pr.url)}
            selectLabel={`${repoRef(pr.repoFullName, pr.number)} ${pr.title}`}
          />
        </div>
      ))}
    </HomeCard>
  )
}

export function UnansweredCard({ data }: { data: HomeSummary['unansweredContributions'] }) {
  const { t } = useTranslation('home')
  return (
    <HomeCard
      id="unanswered"
      title={t('cards.unanswered.title')}
      count={data.count}
      more={<MoreHint id="unanswered" list={data} />}
    >
      {data.items.length === 0 ? (
        <Empty>{t('cards.unanswered.empty')}</Empty>
      ) : (
        data.items.map(({ kind, item }) => {
          const ref = repoRef(item.repoFullName, item.number)
          const kindLabel = kind === 'pull_request' ? t('kind.pullRequest') : t('kind.issue')
          return (
            <div key={item.id} data-testid={`home-row-unanswered-${item.repoId}-${item.number}`}>
              <ListRow
                className={ROW_CLASS}
                icon={
                  kind === 'pull_request' ? (
                    <GitPullRequest size={14} aria-label={kindLabel} />
                  ) : (
                    <CircleDot size={14} aria-label={kindLabel} />
                  )
                }
                title={item.title}
                meta={
                  <>
                    {ref} · {item.author.login}
                  </>
                }
                right={<RelativeTime date={item.updatedAt} />}
                onSelect={() => open(item.url)}
                selectLabel={`${ref} ${item.title}`}
              />
            </div>
          )
        })
      )}
    </HomeCard>
  )
}

export function StarChangesCard({ data }: { data: HomeSummary['starChanges'] }) {
  const { t, i18n } = useTranslation('home')
  const navigate = useNavigate()
  const nf = new Intl.NumberFormat(i18n.language)
  const total = data.items.reduce((sum, item) => sum + item.gained, 0)
  return (
    <HomeCard
      id="starChanges"
      title={t('cards.starChanges.title')}
      subtitle={t('cards.starChanges.subtitle', { count: data.windowDays })}
    >
      {data.items.length === 0 ? (
        <Empty>{t('cards.starChanges.empty')}</Empty>
      ) : (
        <>
          <MetricCard
            label={t('cards.starChanges.total', { count: data.windowDays })}
            value={`+${nf.format(total)}`}
            className="bg-transparent px-5"
          />
          {data.items.map((item) => (
            <div key={item.repoId} data-testid={`home-row-starChanges-${item.repoId}`}>
              <ListRow
                className={ROW_CLASS}
                icon={<Star size={14} aria-hidden />}
                title={item.repoFullName}
                right={
                  <span
                    className="font-medium text-fg tabular-nums"
                    title={item.truncated ? t('cards.starChanges.truncatedHint') : undefined}
                  >
                    +{nf.format(item.gained)}
                    {item.truncated ? '+' : ''}
                  </span>
                }
                onSelect={() => void navigate(`/repos/${item.repoId}`)}
                selectLabel={item.repoFullName}
              />
            </div>
          ))}
        </>
      )}
    </HomeCard>
  )
}
