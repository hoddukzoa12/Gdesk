import type { DatabaseSync } from 'node:sqlite'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { ActionAvailability, ActionBlockReason, ActionResult } from '@shared/domain/actions'
import type { SessionState } from '@shared/domain/session'
import {
  getRepository,
  markNotificationRead,
  removeNotification,
  restoreNotification,
  restoreStarred,
  setStarred
} from '../cache'
import { GitHubClientError } from '../github/client/errors'
import type { GitHubClient } from '../github/client/client'

/**
 * 쓰기 동작(spec §6): 스타·스타 취소, 알림 읽음·완료.
 *
 * - 막힘: 로그인되어 있지 않거나 연결 상태가 online 이 아니면 요청도 캐시 변경도 하지 않고 이유를 돌려준다.
 *   우선순위 session_expired > signed_out > offline > rate_limited (세션이 연결보다 먼저, spec §7).
 * - 낙관적 갱신: 캐시를 먼저 바꾸고 notify(화면 다시 읽기) → GitHub 요청. 실패하면 이전 값으로 정확히
 *   되돌리고 다시 notify 한 뒤 failed 를 돌려준다. 쓰기를 모아 두었다가 나중에 보내는 큐는 없다.
 * - 동시성: 같은 대상(저장소 ID·스레드 ID)의 동작은 순서대로 하나씩 처리한다(직렬화). 뒤 동작은 앞 동작이
 *   끝난 뒤(실패면 되돌린 뒤) 그때의 상태로 막힘을 다시 판단하고 실행한다. 다른 대상끼리는 기다리지 않는다.
 *   무시하지 않고 직렬화하는 이유: 사용자의 마지막 의도(예: 스타 → 취소)가 최종 상태가 되게 하기 위해서다.
 *   이 직렬화는 앱이 켜져 있는 동안 진행 중인 동작 뒤에서만 기다리며, 막힘 상태에서 쌓아 두지 않는다.
 */

export type ActionsClient = Pick<
  GitHubClient,
  'put' | 'patch' | 'delete' | 'getStatus' | 'onStatusChange'
>

export interface ActionsServiceOptions {
  /** 호출 시점에 DB 를 가져온다(앱에서는 getDb) */
  db: () => DatabaseSync
  client: ActionsClient
  /** 현재 세션. 읽을 수 없으면(인증 초기화 전) 던져도 된다 → signed_out */
  getSession: () => { state: SessionState }
  /** 캐시가 바뀐 범위를 화면에 알린다(앱에서는 notifyDataChanged) */
  notify: (keys: string[]) => void
  /** 세션 변경 구독(가용성 이벤트용) */
  onAuthChanged?: (listener: () => void) => () => void
  now?: () => number
}

export interface ActionsService {
  star(repoId: number, starred: boolean): Promise<ActionResult>
  markRead(threadId: string): Promise<ActionResult>
  markDone(threadId: string): Promise<ActionResult>
  getAvailability(): ActionAvailability
  /** 가용성이 실제로 바뀔 때만 알린다 */
  onAvailabilityChange(listener: (availability: ActionAvailability) => void): () => void
  dispose(): void
}

export function starKeys(repoId: number): string[] {
  return ['starred', 'repositories', 'home', `repo:${repoId}`]
}

export const NOTIFICATION_KEYS: readonly string[] = ['inbox', 'sidebar', 'home']

const GENERIC_FAILURE = 'The request to GitHub failed'

/** 화면에 보여도 되는 문구. 요청 계층 오류는 이미 토큰을 지운 문구라 그대로 쓰고, 그 밖은 일반 문구 */
export function safeMessage(error: unknown): string {
  if (error instanceof GitHubClientError && error.message) return error.message
  return GENERIC_FAILURE
}

function failed(message: string): ActionResult {
  return { ok: false, reason: 'failed', message }
}

/**
 * 쓰기 막힘 이유. 우선순위 session_expired > signed_out > offline > rate_limited. 막힘이 없으면 null.
 * 이슈 쓰기 동작(issue-actions.service.ts)도 같은 판단을 쓴다.
 */
export function resolveActionBlockReason(
  state: SessionState,
  status: ConnectionStatus
): ActionBlockReason | null {
  if (state === 'expired' || status === 'session_expired') return 'session_expired'
  if (state !== 'signed_in') return 'signed_out'
  if (status === 'offline') return 'offline'
  if (status === 'rate_limited') return 'rate_limited'
  return null
}

/** 세션을 읽는다. 읽을 수 없으면(인증 초기화 전) signed_out */
export function readSessionState(getSession: () => { state: SessionState }): SessionState {
  try {
    return getSession().state
  } catch {
    return 'signed_out'
  }
}

/**
 * 같은 key 의 작업을 순서대로 하나씩 실행하는 함수를 만든다. 앞 작업의 실패는 뒤 작업에 영향을 주지 않는다.
 * 작업이 던지면 onError 의 값으로 끝난다. 막힘 상태에서 쌓아 두는 대기열이 아니다(진행 중인 작업 뒤에서만 기다린다).
 */
export function createKeyedSerializer(): <R>(
  key: string,
  task: () => Promise<R>,
  onError: (error: unknown) => R
) => Promise<R> {
  const tails = new Map<string, Promise<unknown>>()
  return <R>(key: string, task: () => Promise<R>, onError: (error: unknown) => R) => {
    const prev = tails.get(key) ?? Promise.resolve()
    const run = prev.then(task, task).catch(onError)
    tails.set(key, run)
    void run.then(() => {
      if (tails.get(key) === run) tails.delete(key)
    })
    return run
  }
}

function sameAvailability(a: ActionAvailability, b: ActionAvailability): boolean {
  if (a.available || b.available) return a.available === b.available
  return a.reason === b.reason
}

export function createActionsService(options: ActionsServiceOptions): ActionsService {
  const { client, notify } = options
  const now = options.now ?? Date.now
  const serialized = createKeyedSerializer()
  const listeners = new Set<(availability: ActionAvailability) => void>()

  function blockReason(): ActionBlockReason | null {
    return resolveActionBlockReason(readSessionState(options.getSession), client.getStatus())
  }

  function getAvailability(): ActionAvailability {
    const reason = blockReason()
    return reason === null ? { available: true } : { available: false, reason }
  }

  let last = getAvailability()
  function recheck(): void {
    const next = getAvailability()
    if (sameAvailability(next, last)) return
    last = next
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch {
        // 구독자 오류는 무시한다
      }
    }
  }

  const unsubscribers = [
    client.onStatusChange(() => recheck()),
    ...(options.onAuthChanged ? [options.onAuthChanged(() => recheck())] : [])
  ]

  /** 같은 key 의 동작을 순서대로 실행한다. 앞 동작의 실패는 뒤 동작에 영향을 주지 않는다 */
  function serialize(key: string, task: () => Promise<ActionResult>): Promise<ActionResult> {
    return serialized(key, task, (error) => failed(safeMessage(error)))
  }

  /**
   * 캐시 변경(apply) → notify → 요청 → 실패면 되돌리기(undo) → notify. 막힘 확인은 호출자가 먼저 한다.
   * apply 가 null 을 돌려주면 캐시를 바꾸지 않은 것이라 notify·되돌리기를 하지 않는다.
   */
  async function optimistic<S>(
    keys: readonly string[],
    apply: () => S | null,
    undo: (snapshot: S) => void,
    request: () => Promise<unknown>
  ): Promise<ActionResult> {
    const snapshot = apply()
    if (snapshot !== null) notify([...keys])
    try {
      await request()
      return { ok: true }
    } catch (error) {
      if (snapshot !== null) {
        undo(snapshot)
        notify([...keys])
      }
      return failed(safeMessage(error))
    }
  }

  function star(repoId: number, starred: boolean): Promise<ActionResult> {
    if (!Number.isSafeInteger(repoId) || repoId <= 0 || typeof starred !== 'boolean') {
      return Promise.resolve(failed('Invalid star request'))
    }
    return serialize(`repo:${repoId}`, async () => {
      const reason = blockReason()
      if (reason !== null) return { ok: false, reason }
      const db = options.db()
      const repo = getRepository(db, repoId)
      if (repo === null) return failed('Repository is not in the local cache')
      const path = `/user/starred/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
      return optimistic(
        starKeys(repoId),
        () => setStarred(db, repoId, starred, now()),
        (snapshot) => restoreStarred(db, snapshot),
        () => (starred ? client.put(path) : client.delete(path))
      )
    })
  }

  function threadAction(
    threadId: string,
    apply: (db: DatabaseSync) => ReturnType<typeof markNotificationRead>,
    request: (path: string) => Promise<unknown>
  ): Promise<ActionResult> {
    if (typeof threadId !== 'string' || threadId.trim() === '') {
      return Promise.resolve(failed('Invalid notification thread'))
    }
    return serialize(`thread:${threadId}`, async () => {
      const reason = blockReason()
      if (reason !== null) return { ok: false, reason }
      const path = `/notifications/threads/${encodeURIComponent(threadId)}`
      return optimistic(
        NOTIFICATION_KEYS,
        () => apply(options.db()),
        (snapshot) => restoreNotification(options.db(), snapshot),
        () => request(path)
      )
    })
  }

  return {
    star,
    markRead: (threadId) =>
      threadAction(
        threadId,
        (db) => markNotificationRead(db, threadId),
        (path) => client.patch(path)
      ),
    markDone: (threadId) =>
      threadAction(
        threadId,
        (db) => removeNotification(db, threadId),
        (path) => client.delete(path)
      ),
    getAvailability,
    onAvailabilityChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      for (const off of unsubscribers) off()
      listeners.clear()
    }
  }
}
