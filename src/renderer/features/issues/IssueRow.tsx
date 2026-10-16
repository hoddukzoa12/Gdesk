import { CircleDot, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IssueLabel, IssueRow as IssueRowData } from '@shared/domain/issue'
import { Badge, ListRow, formatRelativeTime, useNow } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { labelChipColors } from './labelColor'

/** 목록 행의 테스트 ID: `issue-row-<저장소>#<번호>` */
export function issueRowTestId(issue: Pick<IssueRowData, 'repoFullName' | 'number'>): string {
  return `issue-row-${issue.repoFullName}#${issue.number}`
}

/** 라벨 칩. 라벨 색을 배경으로, 글자는 읽기 좋은 검정·흰색. 색이 없으면 중립 배지 */
export function LabelChip({ label }: { label: IssueLabel }) {
  const colors = labelChipColors(label.color)
  if (!colors) {
    return (
      <Badge variant="neutral" data-label={label.name}>
        {label.name}
      </Badge>
    )
  }
  return (
    <Badge
      data-label={label.name}
      className="border-transparent"
      style={{ backgroundColor: colors.background, color: colors.foreground }}
    >
      {label.name}
    </Badge>
  )
}

/** "2 hours ago" / "2시간 전"(긴 꼴). 30초마다 다시 계산한다 */
export function useAgo(date: string): string {
  const { i18n } = useTranslation()
  const now = useNow()
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return formatRelativeTime(d, now, i18n.language, 'long')
}

export interface IssueRowProps {
  issue: IssueRowData
  selected: boolean
  onSelect: () => void
}

/** 이슈 한 줄(spec §6.1). 누르면 오른쪽 상세 패널에 연다 */
export function IssueRow({ issue, selected, onSelect }: IssueRowProps) {
  const { t } = useTranslation('issues')
  const ago = useAgo(issue.createdAt)
  return (
    <ListRow
      onSelect={onSelect}
      selected={selected}
      className={cn('min-h-14 py-2.5', selected && 'shadow-[inset_2px_0_0_var(--color-accent)]')}
      selectLabel={t('row.label', {
        repo: issue.repoFullName,
        number: issue.number,
        title: issue.title
      })}
      icon={<CircleDot size={16} aria-hidden className="text-success" />}
      title={<span className="font-medium text-fg">{issue.title}</span>}
      meta={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{issue.repoFullName}</span>
          <span className="shrink-0 text-fg-subtle">#{issue.number}</span>
          <span aria-hidden className="shrink-0 text-fg-subtle">
            ·
          </span>
          <time dateTime={issue.createdAt} className="shrink-0">
            {t('row.opened', { time: ago })}
          </time>
        </span>
      }
      right={
        <>
          {issue.labels.length > 0 && (
            <span
              className="inline-flex max-w-56 min-w-0 flex-wrap items-center justify-end gap-1"
              aria-label={t('row.labels')}
              role="list"
            >
              {issue.labels.slice(0, 3).map((label) => (
                <span key={label.name} role="listitem" className="inline-flex">
                  <LabelChip label={label} />
                </span>
              ))}
              {issue.labels.length > 3 && (
                <span role="listitem" className="text-[11px] text-fg-subtle">
                  +{issue.labels.length - 3}
                </span>
              )}
            </span>
          )}
          <span
            className="inline-flex w-10 items-center justify-end gap-1 tabular-nums"
            aria-label={t('row.comments', { count: issue.commentCount })}
            title={t('row.comments', { count: issue.commentCount })}
            data-comments={issue.commentCount}
          >
            <MessageSquare size={13} aria-hidden />
            {issue.commentCount}
          </span>
        </>
      }
    />
  )
}
