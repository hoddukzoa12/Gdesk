import { Outlet } from 'react-router'

/** 앱 틀 자리. 사이드바·본문 레이아웃은 앱 틀 작업에서 채운다. */
export function AppLayout() {
  return (
    <div className="flex h-screen bg-bg text-fg">
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
