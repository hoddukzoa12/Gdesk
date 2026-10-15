import { CircleDot, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IssueLabel, IssueRow as IssueRowData } from '@shared/domain/issue'
import { Avatar, Badge, ListRow, RelativeTime, openExternal } from '@renderer/components'
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

/** 이슈 한 줄. 누르면 GitHub 페이지를 브라우저로 연다 */
export function IssueRow({ issue }: { issue: IssueRowData }) {
  const { t } = useTranslation('issues')
  return (
    <ListRow
      onSelect={() => void openExternal(issue.url)}
      selectLabel={t('row.label', {
        repo: issue.repoFullName,
        number: issue.number,
        title: issue.title
      })}
      icon={<CircleDot size={15} aria-hidden className="text-success" />}
      title={issue.title}
      meta={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{issue.repoFullName}</span>
          <span className="shrink-0 text-fg-subtle">#{issue.number}</span>
          {issue.labels.length > 0 && (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              aria-label={t('row.labels')}
              role="list"
            >
              {issue.labels.map((label) => (
                <span key={label.name} role="listitem" className="inline-flex">
                  <LabelChip label={label} />
                </span>
              ))}
            </span>
          )}
        </span>
      }
      right={
        <>
          <span
            className="inline-flex items-center gap-1 tabular-nums"
            aria-label={t('row.comments', { count: issue.commentCount })}
            title={t('row.comments', { count: issue.commentCount })}
            data-comments={issue.commentCount}
          >
            <MessageSquare size={13} aria-hidden />
            {issue.commentCount}
          </span>
          <span className="inline-flex max-w-40 items-center gap-1.5">
            <Avatar
              src={issue.author.avatarUrl}
              name={issue.author.login}
              size={16}
              shape={issue.author.isBot ? 'square' : 'circle'}
            />
            <span className="truncate">{issue.author.login}</span>
          </span>
          <RelativeTime date={issue.updatedAt} className="w-14 text-right tabular-nums" />
        </>
      }
    />
  )
}
