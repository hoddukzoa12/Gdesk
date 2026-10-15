import type { ReactNode } from 'react'
import { Tooltip } from 'radix-ui'
import { PreferencesProvider } from './preferences'
import { registeredSlots } from './slots'

// 등록된 공급 훅은 모듈을 읽을 때 정해지고 바뀌지 않는다.
const usePreferencesSource = registeredSlots.preferencesSource ?? (() => undefined)

/** 라우터 바깥 공용 공급자: 테마·언어(설정 슬롯과 연결), 툴팁. */
export function AppProviders({ children }: { children: ReactNode }) {
  const source = usePreferencesSource()
  return (
    <PreferencesProvider value={source?.value} onChange={source?.onChange}>
      <Tooltip.Provider delayDuration={400}>{children}</Tooltip.Provider>
    </PreferencesProvider>
  )
}
