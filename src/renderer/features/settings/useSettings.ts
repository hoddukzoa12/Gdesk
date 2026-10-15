import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { Settings, SettingsPatch } from '@shared/domain/settings'
import '@shared/ipc/settings'
import { invoke, useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

// 마지막으로 보낸 저장 요청 번호와 아직 응답을 못 받은 요청 수.
// 앞선 요청의 응답·알림이 늦게 와서 화면에 먼저 반영한 더 새 값을 덮어쓰지 않게 한다.
let latestRequest = 0
let pendingRequests = 0

/** 설정을 한 번 읽고, `settings:changed` 알림을 조회 캐시에 바로 넣는다. */
export function useSettings(): UseQueryResult<Settings> {
  const client = useQueryClient()
  const query = useIpcQuery('settings:get')
  const onChanged = useCallback(
    (next: Settings) => {
      // 저장 중이면 마지막 응답이 최종 값을 넣는다
      if (pendingRequests === 0) client.setQueryData(['settings:get'], next)
    },
    [client]
  )
  useIpcEvent('settings:changed', onChanged)
  return query
}

/**
 * 설정 일부를 저장하는 함수. 바꾼 키만 보낸다.
 * 화면이 바로 바뀌도록 캐시에 먼저 반영하고, 마지막 요청의 응답(전체 설정)으로 맞춘다. 실패하면 다시 읽는다.
 */
export function useUpdateSettings(): (patch: SettingsPatch) => Promise<Settings | null> {
  const client = useQueryClient()
  return useCallback(
    async (patch: SettingsPatch) => {
      const prev = client.getQueryData<Settings>(['settings:get'])
      if (prev) client.setQueryData<Settings>(['settings:get'], { ...prev, ...patch })
      const request = ++latestRequest
      pendingRequests += 1
      try {
        const next = await invoke('settings:update', patch)
        pendingRequests -= 1
        if (request === latestRequest) client.setQueryData(['settings:get'], next)
        return next
      } catch {
        pendingRequests -= 1
        if (request === latestRequest) {
          await client.invalidateQueries({ queryKey: ['settings:get'] })
        }
        return null
      }
    },
    [client]
  )
}
