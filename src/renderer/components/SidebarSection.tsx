import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface SidebarSectionProps {
  title: ReactNode
  /** 제목 오른쪽 작은 동작(예: 더 보기). */
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

/** 사이드바 섹션 틀(Pinned, Your repositories). 기능 작업이 슬롯 안에서 쓴다. */
export function SidebarSection({ title, actions, children, className }: SidebarSectionProps) {
  return (
    <section className={cn('mt-4', className)}>
      <header className="flex h-6 items-center px-3 text-[11px] font-medium text-fg-subtle">
        <h2 className="truncate">{title}</h2>
        {actions && <div className="ml-auto flex items-center">{actions}</div>}
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

export interface SidebarItemProps {
  icon?: ReactNode
  label: ReactNode
  /** 오른쪽 끝(스타 수, PR 수 등). */
  trailing?: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

/** 사이드바 한 줄 버튼. 메뉴와 같은 모양. */
export function SidebarItem({
  icon,
  label,
  trailing,
  active,
  onClick,
  className
}: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={sidebarItemClass(active, className)}
    >
      {icon && <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing && (
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-fg-muted tabular-nums">
          {trailing}
        </span>
      )}
    </button>
  )
}

/** 메뉴·사이드바 줄 공통 클래스. */
export function sidebarItemClass(active?: boolean, className?: string): string {
  return cn(
    'mx-1.5 flex h-7 items-center gap-2 rounded-md px-2 text-[13px] outline-none transition-colors',
    'focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'bg-bg-subtle text-fg' : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
    className
  )
}
