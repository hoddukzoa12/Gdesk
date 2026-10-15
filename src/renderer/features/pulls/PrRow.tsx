import { GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PrReviewStatus, PullRequestRow } from '@shared/domain/pr'
import {
  Avatar,
  Badge,
  CiStatusIcon,
  ListRow,
  RelativeTime,
  openExternal,
  type BadgeVariant
} from '@renderer/components'

/** 리뷰 상태 → 배지 색. `none` 은 그리지 않는다. */
const REVIEW_BADGE: Record<Exclude<PrReviewStatus, 'none'>, BadgeVariant> = {
  approved: 'success',
  changes_requested: 'danger',
  review_required: 'warning'
}

/** 목록 행의 테스트 ID: `pr-row-<저장소>#<번호>` */
export function prRowTestId(pr: Pick<PullRequestRow, 'repoFullName' | 'number'>): string {
  return `pr-row-${pr.repoFullName}#${pr.number}`
}

export function ReviewStatusBadge({ status }: { status: PrReviewStatus }) {
  const { t } = useTranslation('pulls')
  if (status === 'none') return null
  return (
    <Badge variant={REVIEW_BADGE[status]} data-review={status}>
      {t(`review.${status}`)}
    </Badge>
  )
}

/** PR 한 줄(Pull requests·Review requests 공용). 누르면 GitHub 페이지를 브라우저로 연다. */
export function PrRow({ pr }: { pr: PullRequestRow }) {
  const { t } = useTranslation('pulls')
  const draft = pr.state === 'draft'
  const Icon = draft ? GitPullRequestDraft : GitPullRequest
  return (
    <ListRow
      onSelect={() => void openExternal(pr.url)}
      selectLabel={t('row.label', { repo: pr.repoFullName, number: pr.number, title: pr.title })}
      icon={
        <Icon
          size={15}
          aria-hidden
          className={draft ? 'text-fg-muted' : 'text-success'}
          data-state={pr.state}
        />
      }
      title={pr.title}
      meta={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{pr.repoFullName}</span>
          <span className="shrink-0 text-fg-subtle">#{pr.number}</span>
        </span>
      }
      right={
        <>
          {draft && (
            <Badge variant="outline" data-draft>
              {t('row.draft')}
            </Badge>
          )}
          <ReviewStatusBadge status={pr.reviewStatus} />
          <CiStatusIcon status={pr.ciStatus} />
          <span className="inline-flex max-w-40 items-center gap-1.5">
            <Avatar
              src={pr.author.avatarUrl}
              name={pr.author.login}
              size={16}
              shape={pr.author.isBot ? 'square' : 'circle'}
            />
            <span className="truncate">{pr.author.login}</span>
          </span>
          <RelativeTime date={pr.updatedAt} className="w-14 text-right tabular-nums" />
        </>
      }
    />
  )
}
