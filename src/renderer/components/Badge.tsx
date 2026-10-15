import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'

export type BadgeVariant = 'neutral' | 'outline' | 'accent' | 'success' | 'danger' | 'warning'

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'bg-bg-subtle text-fg-muted border-transparent',
  outline: 'bg-transparent text-fg-muted border-border',
  accent: 'bg-accent/15 text-accent border-transparent',
  success: 'bg-success/15 text-success border-transparent',
  danger: 'bg-danger/15 text-danger border-transparent',
  warning: 'bg-warning/15 text-warning border-transparent'
}

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: BadgeVariant
}

/** 작은 라벨(공개 여부, 토픽 등). */
export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap',
        variantClass[variant],
        className
      )}
      {...props}
    />
  )
}

export interface CountBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  count: number | null | undefined
  /** 이 값을 넘으면 `max+` 로 표시. 기본 999. */
  max?: number
  /** 0 도 표시할지. 기본 false(0 이면 아무것도 그리지 않음). */
  showZero?: boolean
  /** 강조(주황) 표시. 기본은 회색 숫자. */
  emphasis?: boolean
}

/** 메뉴·탭 옆 숫자. */
export function CountBadge({
  count,
  max = 999,
  showZero = false,
  emphasis = false,
  className,
  ...props
}: CountBadgeProps) {
  const { i18n } = useTranslation()
  if (count == null || (count === 0 && !showZero)) return null
  const nf = new Intl.NumberFormat(i18n.language)
  const text = count > max ? `${nf.format(max)}+` : nf.format(count)
  return (
    <span
      className={cn(
        'inline-flex min-w-4 items-center justify-center text-[11px] leading-none tabular-nums',
        emphasis ? 'rounded-full bg-accent/15 px-1.5 py-0.5 text-accent' : 'text-fg-muted',
        className
      )}
      {...props}
    >
      {text}
    </span>
  )
}
