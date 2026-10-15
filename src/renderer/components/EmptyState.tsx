import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** 목록 안의 한 줄 크기. 기본 false(가운데 큰 안내). */
  compact?: boolean
  className?: string
}

/** 빈 목록·빈 화면 안내. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className={cn('px-4 py-3 text-[13px] text-fg-muted', className)}>
        {title}
        {description && <span className="ml-1 text-fg-subtle">{description}</span>}
      </div>
    )
  }
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className
      )}
    >
      {icon && <div className="mb-1 text-fg-subtle [&_svg]:size-8">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
