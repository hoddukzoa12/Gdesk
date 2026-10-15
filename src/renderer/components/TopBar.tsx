import { createContext, useContext } from 'react'

/**
 * 앱 틀이 본문 맨 위에 두는 상단 막대(창 끌기 영역). PageHeader 는 이 자리로 포털된다.
 * 앱 틀 밖(테스트 등)에서는 null 이라 PageHeader 가 제자리에 그려진다.
 */
export const TopBarContext = createContext<HTMLElement | null>(null)

export function useTopBarNode(): HTMLElement | null {
  return useContext(TopBarContext)
}
