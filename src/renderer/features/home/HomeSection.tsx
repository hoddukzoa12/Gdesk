import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HomeSectionId } from '@shared/domain/homeCards'
import { Button, CountBadge, focusRing } from '@renderer/components'
import { cn } from '@renderer/lib/cn'

/**
 * Home 영역 틀: 둥근 카드, 가는 테두리, 큰 제목. 열 개 영역 모두 이 틀을 쓰고
 * `home-card-<id>` 테스트 ID 를 갖는다.
 */
export function HomeSection({
  id,
  title,
  count,
  subtitle,
  actions,
  children,
  className
}: {
  id: HomeSectionId
  title: ReactNode
  /** 제목 옆 개수 배지 */
  count?: number
  subtitle?: ReactNode
  /** 머리 오른쪽(예: "View all →") */
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      data-testid={`home-card-${id}`}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated',
        className
      )}
    >
      <header className="flex min-h-12 items-center gap-2 px-5 pt-4 pb-2">
        <h2 className="truncate text-[15px] font-semibold text-fg">{title}</h2>
        {count !== undefined && (
          <CountBadge
            count={count}
            showZero
            className="h-5 min-w-5 rounded-full bg-bg-subtle px-1.5 font-medium text-fg"
          />
        )}
        {subtitle && <span className="truncate text-xs text-fg-muted">{subtitle}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col pb-2">{children}</div>
    </section>
  )
}

/** 머리 오른쪽 "View all →" */
export function ViewAllButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  const { t } = useTranslation('home')
  return (
    <Button size="sm" variant="ghost" onClick={onClick} data-testid={testId}>
      {t('viewAll')}
      <ArrowRight />
    </Button>
  )
}

/**
 * 영역 안의 누를 수 있는 한 줄. 줄 전체가 버튼이다(안에 다른 버튼을 넣지 않는다).
 */
export function SectionRow({
  icon,
  title,
  meta,
  right,
  onSelect,
  label,
  testId
}: {
  icon?: ReactNode
  title: ReactNode
  meta?: ReactNode
  right?: ReactNode
  onSelect: () => void
  label: string
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      data-testid={testId}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 px-5 py-2 text-left text-[13px] transition-colors',
        'hover:bg-bg-hover',
        focusRing,
        'focus-visible:ring-inset'
      )}
    >
      {icon && <span className="flex shrink-0 items-center text-fg-muted">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-fg">{title}</span>
        {meta && <span className="truncate text-xs text-fg-muted">{meta}</span>}
      </span>
      {right && (
        <span className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">{right}</span>
      )}
    </button>
  )
}

/** 빈 영역·아직 받지 않은 영역 안내 */
export function SectionNotice({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="px-5 py-3 text-[13px] text-fg-muted" data-testid={testId}>
      {children}
    </p>
  )
}
