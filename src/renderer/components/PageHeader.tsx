import { Fragment, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { useTopBarNode } from './TopBar'

export interface BreadcrumbItem {
  label: ReactNode
  /** 앞에 붙는 작은 아이콘·아바타. */
  icon?: ReactNode
  /** 누를 수 있으면 동작. */
  onClick?: () => void
}

export interface PageHeaderProps {
  /** `owner / name` 경로. 마지막 항목이 굵게 표시된다. */
  breadcrumb: BreadcrumbItem[]
  /** 경로 오른쪽의 탭(보통 TabsList). */
  tabs?: ReactNode
  /** 오른쪽 끝 동작(예: "Open on GitHub"). */
  actions?: ReactNode
  className?: string
}

/**
 * 본문 상단 막대: 경로 + 탭 + 오른쪽 동작. 앱 틀 안에서는 창 끌기 영역인 상단 막대로 포털되고,
 * 앱 틀 밖에서는 제자리에 그려진다.
 */
export function PageHeader({ breadcrumb, tabs, actions, className }: PageHeaderProps) {
  const { t } = useTranslation('common')
  const node = useTopBarNode()
  const last = breadcrumb.length - 1
  const content = (
    <div className={cn('flex min-w-0 flex-1 items-center gap-4', className)} data-page-header>
      <nav
        aria-label={t('breadcrumb')}
        className="flex min-w-0 shrink items-center gap-1.5 text-[13px]"
      >
        {breadcrumb.map((item, i) => {
          const inner = (
            <>
              {item.icon}
              <span className="truncate">{item.label}</span>
            </>
          )
          const cls = cn(
            'inline-flex min-w-0 items-center gap-1.5',
            i === last ? 'font-semibold text-fg' : 'text-fg-muted'
          )
          return (
            <Fragment key={i}>
              {i > 0 && (
                <span aria-hidden className="text-fg-subtle">
                  /
                </span>
              )}
              {item.onClick ? (
                <button type="button" onClick={item.onClick} className={cn(cls, 'hover:text-fg')}>
                  {inner}
                </button>
              ) : (
                <span className={cls} aria-current={i === last ? 'page' : undefined}>
                  {inner}
                </span>
              )}
            </Fragment>
          )
        })}
      </nav>
      {tabs && <div className="min-w-0 overflow-x-auto">{tabs}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
  return node ? createPortal(content, node) : content
}
