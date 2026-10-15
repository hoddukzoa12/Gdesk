import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ListPage } from '@shared/domain/list'
import { EmptyState, ErrorState, ExternalLink, Spinner } from '@renderer/components'

/** "GitHub 에서 더 보기" 주소: 목록 항목 주소의 GitHub 웹 주소(origin)에 경로를 붙인다. */
export function githubListUrl(items: ReadonlyArray<{ url: string }>, path: string): string | null {
  const first = items[0]
  if (!first) return null
  try {
    return new URL(path, new URL(first.url).origin).toString()
  } catch {
    return null
  }
}

export interface ListViewProps<T> {
  query: UseQueryResult<ListPage<T>>
  /** 목록(ul)의 접근성 이름 */
  label: string
  emptyTitle: string
  emptyDescription?: string
  errorMessage: string
  /** 다 받지 못한 목록(complete=false) 아래에 붙는 안내 */
  moreHint: (page: ListPage<T>) => ReactNode
  itemKey: (item: T) => string
  itemTestId: (item: T) => string
  renderItem: (item: T) => ReactNode
}

/** PR·이슈 목록 본문: 불러오는 중 · 오류 · 빈 목록 · 행들 · "GitHub 에서 더 보기". */
export function ListView<T>({
  query,
  label,
  emptyTitle,
  emptyDescription,
  errorMessage,
  moreHint,
  itemKey,
  itemTestId,
  renderItem
}: ListViewProps<T>) {
  if (query.isPending) {
    return (
      <div className="flex justify-center py-12" data-testid="list-loading">
        <Spinner />
      </div>
    )
  }
  if (query.isError) {
    return <ErrorState message={errorMessage} onRetry={() => void query.refetch()} />
  }
  const page = query.data
  if (page.items.length === 0) {
    return (
      <div data-testid="list-empty">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    )
  }
  return (
    <>
      <ul aria-label={label} className="divide-y divide-border border-b border-border">
        {page.items.map((item) => (
          <li key={itemKey(item)} data-testid={itemTestId(item)}>
            {renderItem(item)}
          </li>
        ))}
      </ul>
      {!page.complete && (
        <div className="px-4 py-3 text-xs text-fg-muted" data-testid="list-more">
          {moreHint(page)}
        </div>
      )}
    </>
  )
}

export interface MoreHintProps {
  text: string
  linkLabel: string
  url: string | null
}

/** "N 개 중 M 개 표시 · GitHub 에서 더 보기" */
export function MoreHint({ text, linkLabel, url }: MoreHintProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{text}</span>
      {url ? (
        <ExternalLink href={url} showIcon className="text-accent">
          {linkLabel}
        </ExternalLink>
      ) : (
        <span>{linkLabel}</span>
      )}
    </span>
  )
}
