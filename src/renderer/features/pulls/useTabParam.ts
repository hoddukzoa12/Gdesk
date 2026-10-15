import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/** 탭을 고르는 주소 검색 값 이름(`?tab=mine`). */
export const TAB_PARAM = 'tab'

/** 주소 값을 아는 탭으로 읽는다. 모르는 값이나 없는 값이면 첫 탭. */
export function parseTab<T extends string>(value: string | null, tabs: readonly T[]): T {
  const found = tabs.find((tab) => tab === value)
  return found ?? (tabs[0] as T)
}

/**
 * 선택한 탭을 주소의 `?tab=` 에 둔다. 새로 고침해도 남고, 뒤로 가기로 이전 탭으로 돌아간다.
 * 첫 탭(기본)은 주소에서 뺀다. 탭을 누르면 Radix 가 mousedown·focus 로 두 번 알리므로 같은 탭으로의
 * 이동은 한 번만 기록한다(뒤로 가기가 같은 탭을 두 번 거치지 않게).
 */
export function useTabParam<T extends string>(tabs: readonly T[]): [T, (next: string) => void] {
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get(TAB_PARAM), tabs)
  const current = useRef(tab)
  useEffect(() => {
    current.current = tab
  }, [tab])
  const setTab = useCallback(
    (next: string) => {
      const value = parseTab(next, tabs)
      if (value === current.current) return
      current.current = value
      setParams((prev) => {
        const out = new URLSearchParams(prev)
        if (value === tabs[0]) out.delete(TAB_PARAM)
        else out.set(TAB_PARAM, value)
        return out
      })
    },
    [setParams, tabs]
  )
  return [tab, setTab]
}
