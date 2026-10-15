import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ActionAvailability } from '@shared/domain/actions'
import '@shared/ipc/actions'
import { invoke, useIpcEvent } from '../ipc'

const QUERY_KEY = ['actions:getAvailability'] as const

// 받은 `actions:availability` 알림 수. 조회 응답보다 알림이 늦게 보낸 값일 수 있으므로,
// 조회 중에 알림이 왔으면 응답 대신 알림 값을 믿는다.
let eventCount = 0

/**
 * 쓰기 가능 여부. 한 번 읽고 `actions:availability` 알림을 조회 캐시에 바로 넣는다.
 * 읽기 전이나 읽지 못했으면 undefined(쓰기 버튼을 끈 채로 둔다).
 */
export function useActionAvailability(): ActionAvailability | undefined {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const seen = eventCount
      const value = await invoke('actions:getAvailability')
      if (seen !== eventCount) {
        return client.getQueryData<ActionAvailability>(QUERY_KEY) ?? value
      }
      return value
    }
  })
  const onEvent = useCallback(
    (value: ActionAvailability) => {
      eventCount += 1
      client.setQueryData(QUERY_KEY, value)
    },
    [client]
  )
  useIpcEvent('actions:availability', onEvent)
  return query.data
}
