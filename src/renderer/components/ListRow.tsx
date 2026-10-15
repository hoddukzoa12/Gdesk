import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from './focus'

export interface ListRowProps {
  /** 왼쪽 아이콘(CiStatusIcon, Avatar 등). */
  icon?: ReactNode
  /** 주 텍스트. 한 줄로 자른다. */
  title: ReactNode
  /** 제목 앞의 짧은 앞머리(예: 커밋 SHA). */
  leading?: ReactNode
  /** 제목 아래 보조 정보. */
  meta?: ReactNode
  /** 오른쪽 끝(작성자, 시각, 버튼 등). 버튼을 넣어도 된다. */
  right?: ReactNode
  /** 행 전체를 누르는 동작. 주어지면 행 전체를 덮는 버튼이 생긴다. */
  onSelect?: () => void
  /** 행 버튼의 접근성 이름. 기본은 title 이 문자열일 때 그 값. */
  selectLabel?: string
  selected?: boolean
  className?: string
}

/** 목록 한 줄(PR, 커밋, 알림 등). */
export function ListRow({
  icon,
  title,
  leading,
  meta,
  right,
  onSelect,
  selectLabel,
  selected,
  className
}: ListRowProps) {
  return (
    <div
      className={cn(
        'group relative flex min-h-9 items-center gap-3 px-4 py-2 text-[13px]',
        onSelect && 'hover:bg-bg-hover',
        selected && 'bg-bg-subtle',
        className
      )}
      data-selected={selected || undefined}
    >
      {onSelect && (
        <button
          type="button"
          onClick={onSelect}
          aria-label={selectLabel ?? (typeof title === 'string' ? title : undefined)}
          aria-current={selected || undefined}
          className={cn(
            'absolute inset-0 rounded-[inherit]',
            focusRing,
            'focus-visible:ring-inset'
          )}
        />
      )}
      {icon && <span className="flex shrink-0 items-center text-fg-muted">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {leading && <span className="shrink-0 font-mono text-xs text-fg-muted">{leading}</span>}
          <span className="truncate">{title}</span>
        </div>
        {meta && <div className="truncate text-xs text-fg-muted">{meta}</div>}
      </div>
      {right && (
        <div className="relative z-10 flex shrink-0 items-center gap-3 text-xs text-fg-muted">
          {right}
        </div>
      )}
    </div>
  )
}
