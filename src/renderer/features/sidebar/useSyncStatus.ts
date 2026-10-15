import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SyncStatus } from '@shared/domain/sync'
import '@shared/ipc/sync'
import { useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

/** 동기화 상태: 한 번 읽고, 이후 `sync:status` 알림을 조회 캐시에 바로 넣는다. */
export function useSyncStatus(): SyncStatus | undefined {
  const client = useQueryClient()
  const { data } = useIpcQuery('sync:getStatus')
  const onStatus = useCallback(
    (status: SyncStatus) => client.setQueryData(['sync:getStatus'], status),
    [client]
  )
  useIpcEvent('sync:status', onStatus)
  return data
}
