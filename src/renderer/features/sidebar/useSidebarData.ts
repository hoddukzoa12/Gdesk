import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { SidebarQueryResult } from '@shared/domain/queries'
import '@shared/ipc/queries'
import '@shared/ipc/pins'
import { useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

/** 사이드바 조회. `data:changed` 는 자동, 고정 변경(`pins:changed`)은 여기서 다시 읽는다. */
export function useSidebarData(): UseQueryResult<SidebarQueryResult> {
  return useIpcQuery('query:sidebar')
}

/**
 * 고정 목록이 바뀌면(이 창·다른 창·계정 정리) 고정 여부를 보여 주는 조회를 다시 읽는다.
 * 고정 변경은 `data:changed` 를 보내지 않으므로 사이드바가 한 번 구독한다.
 */
export function usePinsChangedRefresh(): void {
  const client = useQueryClient()
  const onPins = useCallback(
    ({ pins }: { pins: Array<{ repoId: number; position: number }> }) => {
      client.setQueryData(['pins:list'], pins)
      void client.invalidateQueries({ queryKey: ['query:sidebar'] })
      void client.invalidateQueries({ queryKey: ['query:repoDetail'] })
    },
    [client]
  )
  useIpcEvent('pins:changed', onPins)
}
