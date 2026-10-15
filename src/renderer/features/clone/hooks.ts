import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import '@shared/ipc/dialog'
import '@shared/ipc/local'
import { useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

/**
 * 저장소의 로컬 연결(최근 사용 순). `local:` 채널은 `query:` 가 아니라 data:changed 로 자동 갱신되지
 * 않으므로 여기서 직접 다시 읽는다(메인은 연결이 바뀌면 `repo:<id>` 를 알린다).
 */
export function useRepoLinks(repoId: number) {
  const client = useQueryClient()
  const query = useIpcQuery('local:listLinks', { repoId })
  const onChanged = useCallback(
    ({ keys }: { keys: string[] }) => {
      if (keys.includes(`repo:${repoId}`) || keys.includes('sidebar')) {
        void client.invalidateQueries({ queryKey: ['local:listLinks'] })
      }
    },
    [client, repoId]
  )
  useIpcEvent('data:changed', onChanged)
  return query
}

/** 연결 목록을 다시 읽게 한다(클론·연결 직후). */
export function useRefreshLinks(): () => void {
  const client = useQueryClient()
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['local:listLinks'] })
  }, [client])
}
