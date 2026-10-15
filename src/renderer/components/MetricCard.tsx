import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface MetricCardProps {
  /** 위쪽 작은 제목(예: "Open pull requests"). */
  label: ReactNode
  /** 큰 값(예: 0, v1.1.1). */
  value?: ReactNode
  /** 값 옆 보조 정보(예: "8h ago", "Passing"). */
  aside?: ReactNode
  /** 값 아래 또는 오른쪽에 들어가는 그래프 자리(MiniBars, Sparkline 등). */
  children?: ReactNode
  className?: string
}

/** 상단 지표 카드. MetricGrid 안에 4개를 나란히 둔다. */
export function MetricCard({ label, value, aside, children, className }: MetricCardProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 bg-bg-elevated px-4 py-3', className)}>
      <div className="truncate text-xs text-fg-muted">{label}</div>
      {(value !== undefined || aside !== undefined) && (
        <div className="flex min-w-0 items-baseline gap-2">
          {value !== undefined && (
            <span className="truncate text-2xl leading-none font-semibold tabular-nums">
              {value}
            </span>
          )}
          {aside !== undefined && <span className="truncate text-xs text-fg-muted">{aside}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

export interface MetricGridProps {
  children: ReactNode
  className?: string
}

/** 지표 카드 줄. 참고 이미지처럼 카드 사이를 가는 선으로 나눈다. */
export function MetricGrid({ children, className }: MetricGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  )
}
