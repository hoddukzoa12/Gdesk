import type { ReactNode } from 'react'
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { Button } from './Button'

export type BannerVariant = 'info' | 'warning' | 'error'

const variantClass: Record<BannerVariant, string> = {
  info: 'border-info/30 bg-info/10 [&>svg]:text-info',
  warning: 'border-warning/30 bg-warning/10 [&>svg]:text-warning',
  error: 'border-danger/30 bg-danger/10 [&>svg]:text-danger'
}

const variantIcon = { info: Info, warning: TriangleAlert, error: CircleAlert } as const

export interface BannerProps {
  variant?: BannerVariant
  title?: ReactNode
  children?: ReactNode
  /** 오른쪽 버튼(예: "다시 로그인"). */
  action?: { label: ReactNode; onClick: () => void }
  /** 주어지면 닫기 버튼을 그린다. */
  onDismiss?: () => void
  className?: string
}

/** 상태 배너(오프라인, 세션 만료 등). error 는 role=alert, 나머지는 role=status. */
export function Banner({
  variant = 'info',
  title,
  children,
  action,
  onDismiss,
  className
}: BannerProps) {
  const { t } = useTranslation('common')
  const Icon = variantIcon[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2.5 border px-3 py-2 text-[13px]',
        variantClass[variant],
        className
      )}
    >
      <Icon size={15} aria-hidden className="shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <span className="font-medium">{title}</span>}
        {title && children ? ' ' : null}
        {children && <span className="text-fg-muted">{children}</span>}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label={t('actions.dismiss')}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
