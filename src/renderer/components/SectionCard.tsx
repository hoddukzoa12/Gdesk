import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { CountBadge } from './Badge'

export interface SectionCardProps {
  title: ReactNode
  /** 제목 옆 숫자(예: Open pull requests 0). */
  count?: number
  /** 제목 옆 보조 글(예: 브랜치 이름 main). */
  subtitle?: ReactNode
  /** 머리 오른쪽(예: "All on GitHub ↗"). */
  actions?: ReactNode
  children?: ReactNode
  /** 본문 안쪽 여백 없이(목록용). 기본 true. */
  flush?: boolean
  className?: string
}

/** 제목이 있는 패널("Open pull requests", "Recent commits" 등). */
export function SectionCard({
  title,
  count,
  subtitle,
  actions,
  children,
  flush = true,
  className
}: SectionCardProps) {
  return (
    <section
      className={cn('overflow-hidden rounded-lg border border-border bg-bg-elevated', className)}
    >
      <header className="flex min-h-10 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="truncate text-[13px] font-medium">{title}</h2>
        {count !== undefined && <CountBadge count={count} showZero />}
        {subtitle && <span className="truncate font-mono text-xs text-fg-muted">{subtitle}</span>}
        {actions && (
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-fg-muted">
            {actions}
          </div>
        )}
      </header>
      <div className={cn(flush ? 'divide-y divide-border' : 'p-4')}>{children}</div>
    </section>
  )
}
