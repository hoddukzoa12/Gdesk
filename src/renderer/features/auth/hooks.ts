import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionSnapshot } from '@shared/domain/session'
import type { SyncStatus } from '@shared/domain/sync'
import '@shared/ipc/auth'
import '@shared/ipc/sync'
import { useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

/** 로그인 세션. 한 번 읽고, 이후 `auth:changed` 알림을 조회 캐시에 바로 넣는다. */
export function useSession(): SessionSnapshot | undefined {
  const client = useQueryClient()
  const { data } = useIpcQuery('auth:getSession')
  const onChanged = useCallback(
    (session: SessionSnapshot) => client.setQueryData(['auth:getSession'], session),
    [client]
  )
  useIpcEvent('auth:changed', onChanged)
  return data
}

/** 자동 갱신 상태(조직 접근 제한 안내용). 한 번 읽고 `sync:status` 로 갱신한다. */
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
