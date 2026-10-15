import { useEffect } from 'react'
import { QueryClient, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type {
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeResponse
} from '@shared/ipc/contract'
import '@shared/ipc/data'

/** 화면에서 메인으로 요청을 보내는 유일한 통로. */
export function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResponse<C>> {
  return window.gdesk.invoke(channel, ...args)
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false }
  }
})

/**
 * 메인의 조회 채널을 react-query 로 읽는다. 쿼리 키는 `[channel, request]`.
 * 데이터 갱신 알림을 받으면 `queryClient.invalidateQueries({ queryKey: [channel] })` 로 다시 읽는다.
 */
export function useIpcQuery<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): UseQueryResult<InvokeResponse<C>> {
  return useQuery({
    queryKey: [channel, ...args],
    queryFn: () => invoke(channel, ...args)
  })
}

/** 메인 이벤트 구독(컴포넌트 수명 동안). */
export function useIpcEvent<E extends EventChannel>(
  event: E,
  listener: (payload: EventPayload<E>) => void
): void {
  useEffect(() => window.gdesk.on(event, listener), [event, listener])
}

/**
 * 캐시 변경 알림(`data:changed`)을 받으면 메인 조회 채널(`query:` 로 시작)을 모두 다시 읽는다.
 * 앱 시작 시 한 번 설치한다(main.tsx).
 */
export function installDataChangedInvalidation(): () => void {
  return window.gdesk.on('data:changed', () => {
    void queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('query:')
    })
  })
}
