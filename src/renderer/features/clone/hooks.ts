import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ActionAvailability } from '@shared/domain/actions'
import type { AppPlatform } from '@shared/domain/app'
import type { Settings } from '@shared/domain/settings'
import '@shared/ipc/actions'
import '@shared/ipc/app'
import '@shared/ipc/dialog'
import '@shared/ipc/local'
import '@shared/ipc/settings'
import { invoke, useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'

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

export function usePlatform(): AppPlatform | null {
  const query = useIpcQuery('app:info')
  return query.data?.platform ?? null
}

/**
 * 설정(클론 기본 폴더·주소 방식·기본 편집기). reloadKey 가 바뀔 때마다 새로 읽고
 * settings:changed 를 따른다(설정 화면이나 테스트가 바꾼 값을 바로 반영).
 */
export function useSettingsSnapshot(reloadKey: unknown = 0): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let alive = true
    invoke('settings:get')
      .then((value) => {
        if (alive) setSettings(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [reloadKey])
  const onChanged = useCallback((value: Settings) => setSettings(value), [])
  useIpcEvent('settings:changed', onChanged)
  return settings
}

/** 쓰기(클론) 가능 여부. 읽기 전에는 undefined */
export function useCloneAvailability(): ActionAvailability | undefined {
  const client = useQueryClient()
  const query = useIpcQuery('actions:getAvailability')
  const onEvent = useCallback(
    (value: ActionAvailability) => client.setQueryData(['actions:getAvailability'], value),
    [client]
  )
  useIpcEvent('actions:availability', onEvent)
  return query.data
}
