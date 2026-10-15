import { useState } from 'react'
import { Outlet } from 'react-router'
import { TopBarContext } from '../components/TopBar'
import { cn } from '../lib/cn'
import { usePlatform } from './platform'
import { Sidebar } from './Sidebar'
import { useSlots } from './slots'

/**
 * 앱 틀: 왼쪽 사이드바 + 오른쪽 본문.
 * 본문 = 상단 막대(창 끌기 영역, PageHeader 가 포털됨 + 전역 동작 슬롯) · 배너 슬롯 · 화면(스크롤).
 * 오버레이 슬롯은 라우터 안 루트에 한 번 그린다.
 */
export function AppLayout() {
  const slots = useSlots()
  const insetTitleBar = usePlatform() === 'darwin'
  const [topBarNode, setTopBarNode] = useState<HTMLDivElement | null>(null)

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg" data-testid="app-layout">
      <Sidebar insetTitleBar={insetTitleBar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            'app-drag flex shrink-0 items-center gap-3 border-b border-border px-4',
            insetTitleBar ? 'h-11' : 'h-10'
          )}
          data-testid="top-bar"
        >
          <div ref={setTopBarNode} className="flex min-w-0 flex-1 items-center" />
          {slots.headerActions.length > 0 && (
            <div className="flex shrink-0 items-center gap-2" data-slot="header-actions">
              {slots.headerActions.map((Action, i) => (
                <Action key={i} />
              ))}
            </div>
          )}
        </div>
        {slots.banners.length > 0 && (
          <div className="flex shrink-0 flex-col" data-slot="banners">
            {slots.banners.map((BannerSlot, i) => (
              <BannerSlot key={i} />
            ))}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto" data-testid="main">
          <TopBarContext.Provider value={topBarNode}>
            <Outlet />
          </TopBarContext.Provider>
        </main>
      </div>
      {slots.overlays.map((Overlay, i) => (
        <Overlay key={i} />
      ))}
    </div>
  )
}
