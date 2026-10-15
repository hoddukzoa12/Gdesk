import { CircleDot, GitPullRequestDraft, MessageSquare, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IssueRow as IssueRowData } from '@shared/domain/issue'
import type { PullRequestRow } from '@shared/domain/pr'
import type { CommitSummary, ReleaseSummary } from '@shared/domain/repo'
import {
  Avatar,
  Badge,
  CiStatusIcon,
  ExternalLink,
  ListRow,
  RelativeTime,
  openExternal
} from '@renderer/components'
import { labelColor } from './repo-detail'

function open(url: string): void {
  void openExternal(url)
}

function Author({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar src={avatarUrl} name={login} size={16} />
      <span className="max-w-[120px] truncate">{login}</span>
    </span>
  )
}

function Comments({ count }: { count: number }) {
  const { t } = useTranslation('repo')
  if (count <= 0) return null
  return (
    <span className="flex items-center gap-1 tabular-nums" title={t('comments', { n: count })}>
      <MessageSquare size={12} aria-hidden />
      <span aria-label={t('comments', { n: count })}>{count}</span>
    </span>
  )
}

export interface PullRowProps {
  pr: PullRequestRow
  /** 리뷰 상태 배지까지 보여 줄지(내 PR 탭) */
  showReview?: boolean
}

const reviewVariant = {
  approved: 'success',
  changes_requested: 'danger',
  review_required: 'warning'
} as const

/** PR 한 줄: CI 아이콘 · #번호 · 제목 · 작성자 · 경과 시간. 누르면 GitHub 에서 연다. */
export function PullRow({ pr, showReview = false }: PullRowProps) {
  const { t } = useTranslation('repo')
  return (
    <div data-testid={`repo-pr-${pr.number}`}>
      <ListRow
        icon={<CiStatusIcon status={pr.ciStatus} />}
        leading={`#${pr.number}`}
        title={pr.title}
        selectLabel={`#${pr.number} ${pr.title}`}
        onSelect={() => open(pr.url)}
        right={
          <>
            {pr.state === 'draft' && (
              <Badge variant="outline">
                <GitPullRequestDraft size={11} aria-hidden />
                {t('pulls.draft')}
              </Badge>
            )}
            {showReview && pr.reviewStatus !== 'none' && (
              <Badge variant={reviewVariant[pr.reviewStatus]}>
                {t(`pulls.review.${pr.reviewStatus}`)}
              </Badge>
            )}
            <Comments count={pr.commentCount} />
            <Author login={pr.author.login} avatarUrl={pr.author.avatarUrl} />
            <RelativeTime date={pr.createdAt} className="w-14 text-right tabular-nums" />
          </>
        }
      />
    </div>
  )
}

/** 커밋 한 줄: CI 아이콘 · 짧은 SHA · 메시지 첫 줄 · 작성자 · 경과 시간 */
export function CommitRow({ commit }: { commit: CommitSummary }) {
  const login = commit.author?.login ?? commit.authorName ?? '?'
  const firstLine = commit.message.split('\n')[0] ?? commit.message
  return (
    <div data-testid={`repo-commit-${commit.sha}`}>
      <ListRow
        icon={<CiStatusIcon status={commit.ciStatus} />}
        leading={commit.shortSha}
        title={firstLine}
        selectLabel={`${commit.shortSha} ${firstLine}`}
        onSelect={() => open(commit.url)}
        right={
          <>
            <Author login={login} avatarUrl={commit.author?.avatarUrl ?? null} />
            {commit.committedAt && (
              <RelativeTime date={commit.committedAt} className="w-14 text-right tabular-nums" />
            )}
          </>
        }
      />
    </div>
  )
}

/** 이슈 한 줄: 저장소#번호 · 제목 · 라벨 · 작성자 · 댓글 · 경과 시간 */
export function IssueRow({ issue }: { issue: IssueRowData }) {
  return (
    <div data-testid={`repo-issue-${issue.number}`}>
      <ListRow
        icon={<CircleDot size={14} className="text-success" aria-hidden />}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{issue.title}</span>
            {issue.labels.map((label) => {
              const color = labelColor(label.color)
              return (
                <Badge
                  key={label.name}
                  variant="outline"
                  className="shrink-0"
                  style={color ? { borderColor: color, color } : undefined}
                >
                  {label.name}
                </Badge>
              )
            })}
          </span>
        }
        meta={`${issue.repoFullName}#${issue.number}`}
        selectLabel={`#${issue.number} ${issue.title}`}
        onSelect={() => open(issue.url)}
        right={
          <>
            <Comments count={issue.commentCount} />
            <Author login={issue.author.login} avatarUrl={issue.author.avatarUrl} />
            <RelativeTime date={issue.createdAt} className="w-14 text-right tabular-nums" />
          </>
        }
      />
    </div>
  )
}

/** 릴리스 한 줄: 태그 · 이름 · 날짜 · 사전 릴리스 표시 */
export function ReleaseRow({ release }: { release: ReleaseSummary }) {
  const { t, i18n } = useTranslation('repo')
  const date = release.publishedAt ?? release.createdAt
  const parsed = new Date(date)
  const absolute = Number.isNaN(parsed.getTime())
    ? null
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(parsed)
  const title = release.name && release.name !== release.tagName ? release.name : release.tagName
  return (
    <div data-testid={`repo-release-${release.tagName}`}>
      <ListRow
        icon={<Tag size={14} aria-hidden />}
        leading={release.tagName}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{title}</span>
            {release.isLatest && <Badge variant="success">{t('releases.latest')}</Badge>}
            {release.isPrerelease && (
              <Badge variant="warning" data-testid="repo-release-prerelease">
                {t('releases.prerelease')}
              </Badge>
            )}
            {release.isDraft && <Badge variant="outline">{t('releases.draft')}</Badge>}
          </span>
        }
        selectLabel={`${release.tagName} ${title}`}
        onSelect={() => open(release.url)}
        right={
          <>
            {absolute && <span className="tabular-nums">{absolute}</span>}
            <RelativeTime date={date} className="w-14 text-right tabular-nums" />
          </>
        }
      />
    </div>
  )
}

/** 목록이 잘렸을 때(complete=false) "GitHub 에서 더 보기" */
export function MoreOnGitHub({ href }: { href: string }) {
  const { t } = useTranslation('repo')
  return (
    <div className="px-4 py-2 text-xs" data-testid="repo-more-on-github">
      <ExternalLink href={href} showIcon>
        {t('moreOnGitHub')}
      </ExternalLink>
    </div>
  )
}
