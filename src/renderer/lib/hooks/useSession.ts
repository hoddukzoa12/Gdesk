import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionSnapshot } from '@shared/domain/session'
import '@shared/ipc/auth'
import { useIpcEvent, useIpcQuery } from '../ipc'

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
