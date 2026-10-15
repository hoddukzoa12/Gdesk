import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CountBadge, sidebarItemClass } from '../components'
import { cn } from '../lib/cn'
import { NAV_ITEMS } from './nav'
import { useNavCounts, useSlots } from './slots'

interface SidebarProps {
  /** 맥 hiddenInset 제목 표시줄: 신호등 버튼 자리를 비운다. */
  insetTitleBar: boolean
}

/** 왼쪽 사이드바 틀: 계정(슬롯) · 메뉴 · 섹션(슬롯) · 하단(슬롯). */
export function Sidebar({ insetTitleBar }: SidebarProps) {
  const { t } = useTranslation('common')
  const slots = useSlots()
  const counts = useNavCounts(slots.navCountHooks)

  return (
    <aside
      className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-bg-sidebar"
      aria-label={t('sidebar.label')}
      data-testid="sidebar"
    >
      {/* 창 끌기 띠(맥 신호등 버튼 자리) */}
      <div className={cn('app-drag shrink-0', insetTitleBar ? 'h-11' : 'h-2')} aria-hidden />

      {slots.sidebarTop.length > 0 && (
        <div className="shrink-0 pb-2" data-slot="sidebar-top">
          {slots.sidebarTop.map((Top, i) => (
            <Top key={i} />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-col gap-px">
            {NAV_ITEMS.map(({ id, path, icon: Icon }) => (
              <li key={id}>
                <NavLink
                  to={path}
                  data-nav={id}
                  className={({ isActive }) => sidebarItemClass(isActive)}
                >
                  <Icon size={15} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(`nav.${id}`)}</span>
                  <CountBadge count={counts[id]} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {slots.sidebarSections.map((Section, i) => (
          <Section key={i} />
        ))}
      </div>

      {slots.sidebarFooter.length > 0 && (
        <div className="shrink-0 border-t border-border px-3 py-2" data-slot="sidebar-footer">
          {slots.sidebarFooter.map((Footer, i) => (
            <Footer key={i} />
          ))}
        </div>
      )}
    </aside>
  )
}
