import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionAvailability } from '@shared/domain/actions'
import '@shared/ipc/actions'
import { invoke, useIpcEvent } from '@renderer/lib/ipc'

/**
 * 쓰기 가능 여부. 처음에 한 번 읽고 `actions:availability` 를 구독한다.
 * 읽기 전에는 null(쓰기 버튼을 끈 채로 둔다).
 */
export function useActionAvailability(): ActionAvailability | null {
  const [availability, setAvailability] = useState<ActionAvailability | null>(null)
  // 첫 조회 응답보다 이벤트가 먼저 오면 이벤트 값을 믿는다
  const gotEvent = useRef(false)

  useEffect(() => {
    let alive = true
    invoke('actions:getAvailability')
      .then((value) => {
        if (alive && !gotEvent.current) setAvailability(value)
      })
      .catch(() => {
        // 읽지 못하면 null 로 두어 쓰기 버튼을 끈다
      })
    return () => {
      alive = false
    }
  }, [])

  const onEvent = useCallback((value: ActionAvailability) => {
    gotEvent.current = true
    setAvailability(value)
  }, [])
  useIpcEvent('actions:availability', onEvent)

  return availability
}
