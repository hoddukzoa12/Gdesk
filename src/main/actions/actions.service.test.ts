import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { SessionState } from '@shared/domain/session'
import { openDatabase } from '../db/connection'
import { getNotification, getRepository, replaceNotifications, upsertRepositories } from '../cache'
import { notificationRecord, repoRecord } from '../cache/test-fixtures'
import type { GitHubClient } from '../github/client'
import { createGitHubClientForTests } from '../github/client/testing'
import { createActionsService, type ActionsClient, type ActionsService } from './actions.service'

const TOKEN = 'ghp_ActionsSecretToken1234567890abcdef'
const STAR_KEYS = ['starred', 'repositories', 'home', 'repo:1']
const INBOX_KEYS = ['inbox', 'sidebar', 'home']

interface Call {
  method: string
  path: string
}

type Responder = (call: Call) => Response | Promise<Response>

function empty(status: number): Response {
  return new Response(null, { status })
}

function fakeClient(responder: Responder): { client: GitHubClient; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const call = { method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname }
    calls.push(call)
    return responder(call)
  })
  const client = createGitHubClientForTests({
    tokenProvider: () => TOKEN,
    fetch: fetchFn as unknown as typeof fetch,
    baseUrl: 'https://api.test'
  })
  return { client, calls }
}

/** 수동으로 풀어 주는 응답 */
function deferred(): { promise: Promise<Response>; resolve: (res: Response) => void } {
  let resolve!: (res: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function doneMarkers(db: DatabaseSync): { thread_id: string; updated_at: string }[] {
  return db.prepare('SELECT thread_id, updated_at FROM cache_notification_done').all() as {
    thread_id: string
    updated_at: string
  }[]
}

describe('쓰기 동작 서비스', () => {
  let db: DatabaseSync
  let session: SessionState
  let notify: ReturnType<typeof vi.fn<(keys: string[]) => void>>
  let service: ActionsService | null

  beforeEach(() => {
    db = openDatabase(':memory:')
    upsertRepositories(db, [
      repoRecord(1, { owner: 'acme', name: 'widget', stargazerCount: 10, viewerHasStarred: false }),
      repoRecord(2, { owner: 'acme', name: 'gadget', stargazerCount: 5, viewerHasStarred: true })
    ])
    replaceNotifications(db, [
      notificationRecord('100', { state: 'unread', updatedAt: '2026-10-10T00:00:00Z' }),
      notificationRecord('200', { state: 'read', updatedAt: '2026-10-11T00:00:00Z' })
    ])
    session = 'signed_in'
    notify = vi.fn<(keys: string[]) => void>()
    service = null
  })

  afterEach(() => {
    service?.dispose()
    db.close()
  })

  function make(client: ActionsClient): ActionsService {
    service = createActionsService({
      db: () => db,
      client,
      getSession: () => ({ state: session }),
      notify
    })
    return service
  }

  describe('스타', () => {
    it('스타: 캐시를 먼저 바꾸고 알린 뒤 PUT /user/starred/{owner}/{repo} 를 보낸다', async () => {
      let seenDuringRequest: unknown = null
      const { client, calls } = fakeClient(() => {
        seenDuringRequest = getRepository(db, 1)
        expect(notify).toHaveBeenCalledTimes(1)
        return empty(204)
      })
      const result = await make(client).star(1, true)
      expect(result).toEqual({ ok: true })
      expect(calls).toEqual([{ method: 'PUT', path: '/user/starred/acme/widget' }])
      expect(seenDuringRequest).toMatchObject({ viewerHasStarred: true, stargazerCount: 11 })
      expect(getRepository(db, 1)).toMatchObject({ viewerHasStarred: true, stargazerCount: 11 })
      expect(getRepository(db, 1)?.starredAt).not.toBeNull()
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(STAR_KEYS))
    })

    it('스타 취소: DELETE /user/starred/{owner}/{repo}', async () => {
      const { client, calls } = fakeClient(() => empty(204))
      expect(await make(client).star(2, false)).toEqual({ ok: true })
      expect(calls).toEqual([{ method: 'DELETE', path: '/user/starred/acme/gadget' }])
      expect(getRepository(db, 2)).toMatchObject({ viewerHasStarred: false, stargazerCount: 4 })
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['starred', 'repo:2']))
    })

    it('이름의 특수 문자는 경로에 맞게 인코딩한다', async () => {
      upsertRepositories(db, [repoRecord(3, { owner: 'a b', name: 'x#y' })])
      const { client, calls } = fakeClient(() => empty(204))
      await make(client).star(3, true)
      expect(calls[0]?.path).toBe('/user/starred/a%20b/x%23y')
    })

    it.each([
      ['500', () => new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 })],
      [
        '네트워크 오류',
        () => {
          throw new TypeError(`fetch failed ${TOKEN}`)
        }
      ]
    ])('%s: 캐시를 정확히 되돌리고 두 번 알린다', async (_name, respond) => {
      const before = getRepository(db, 1)
      const { client } = fakeClient(respond)
      const result = await make(client).star(1, true)
      expect(result).toMatchObject({ ok: false, reason: 'failed' })
      if (result.ok || result.reason !== 'failed') throw new Error('unreachable')
      expect(result.message).not.toContain(TOKEN)
      expect(result.message.length).toBeGreaterThan(0)
      expect(getRepository(db, 1)).toEqual(before)
      expect(notify).toHaveBeenCalledTimes(2)
      expect(notify.mock.calls[0]?.[0]).toEqual(notify.mock.calls[1]?.[0])
      expect(notify.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(STAR_KEYS))
    })

    it('스타 취소 실패도 스타 시각·수까지 그대로 되돌린다', async () => {
      db.prepare(
        "UPDATE cache_repositories SET starred_at = '2026-01-01T00:00:00Z' WHERE id = 2"
      ).run()
      const before = getRepository(db, 2)
      const { client } = fakeClient(() => empty(500))
      expect(await make(client).star(2, false)).toMatchObject({ ok: false, reason: 'failed' })
      expect(getRepository(db, 2)).toEqual(before)
      expect(before).toMatchObject({ starredAt: '2026-01-01T00:00:00Z', stargazerCount: 5 })
    })

    it('캐시에 없는 저장소는 요청하지 않고 failed', async () => {
      const { client, calls } = fakeClient(() => empty(204))
      const result = await make(client).star(999, true)
      expect(result).toMatchObject({ ok: false, reason: 'failed' })
      expect(calls).toEqual([])
      expect(notify).not.toHaveBeenCalled()
    })

    it('잘못된 저장소 ID 는 요청하지 않는다', async () => {
      const { client, calls } = fakeClient(() => empty(204))
      expect(await make(client).star(-1, true)).toMatchObject({ ok: false, reason: 'failed' })
      expect(await make(client).star(1.5, true)).toMatchObject({ ok: false, reason: 'failed' })
      expect(calls).toEqual([])
    })
  })

  describe('알림', () => {
    it('읽음: PATCH /notifications/threads/{id} (205), 캐시 먼저 바꾸고 알린다', async () => {
      let stateDuringRequest: string | undefined
      const { client, calls } = fakeClient(() => {
        stateDuringRequest = getNotification(db, '100')?.state
        return empty(205)
      })
      expect(await make(client).markRead('100')).toEqual({ ok: true })
      expect(calls).toEqual([{ method: 'PATCH', path: '/notifications/threads/100' }])
      expect(stateDuringRequest).toBe('read')
      expect(getNotification(db, '100')?.state).toBe('read')
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(INBOX_KEYS))
    })

    it('완료: DELETE /notifications/threads/{id} (204), 목록에서 빠지고 완료 기록이 남는다', async () => {
      const { client, calls } = fakeClient(() => empty(204))
      expect(await make(client).markDone('100')).toEqual({ ok: true })
      expect(calls).toEqual([{ method: 'DELETE', path: '/notifications/threads/100' }])
      expect(getNotification(db, '100')).toBeNull()
      expect(doneMarkers(db)).toEqual([{ thread_id: '100', updated_at: '2026-10-10T00:00:00Z' }])
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(INBOX_KEYS))
    })

    it.each([
      ['500', () => empty(500)],
      [
        '네트워크 오류',
        () => {
          throw new TypeError('socket hang up')
        }
      ]
    ])('읽음 실패(%s): 안 읽음으로 되돌리고 두 번 알린다', async (_name, respond) => {
      const before = getNotification(db, '100')
      const { client } = fakeClient(respond)
      expect(await make(client).markRead('100')).toMatchObject({ ok: false, reason: 'failed' })
      expect(getNotification(db, '100')).toEqual(before)
      expect(before?.state).toBe('unread')
      expect(doneMarkers(db)).toEqual([])
      expect(notify).toHaveBeenCalledTimes(2)
      expect(notify.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(INBOX_KEYS))
    })

    it.each([
      ['500', () => empty(500)],
      [
        '네트워크 오류',
        () => {
          throw new TypeError('socket hang up')
        }
      ]
    ])('완료 실패(%s): 행과 완료 기록을 정확히 되돌린다', async (_name, respond) => {
      const before = getNotification(db, '200')
      const { client } = fakeClient(respond)
      expect(await make(client).markDone('200')).toMatchObject({ ok: false, reason: 'failed' })
      expect(getNotification(db, '200')).toEqual(before)
      expect(doneMarkers(db)).toEqual([])
      expect(notify).toHaveBeenCalledTimes(2)
    })

    it('캐시에 없는 스레드도 GitHub 에는 보내지만 캐시·알림은 건드리지 않는다', async () => {
      const { client, calls } = fakeClient(() => empty(205))
      expect(await make(client).markRead('nope')).toEqual({ ok: true })
      expect(calls).toEqual([{ method: 'PATCH', path: '/notifications/threads/nope' }])
      expect(notify).not.toHaveBeenCalled()
    })

    it('빈 스레드 ID 는 요청하지 않는다', async () => {
      const { client, calls } = fakeClient(() => empty(205))
      expect(await make(client).markDone('')).toMatchObject({ ok: false, reason: 'failed' })
      expect(calls).toEqual([])
    })
  })

  describe('막힘(요청도 캐시 변경도 없음)', () => {
    const cases: [string, ConnectionStatus, SessionState, string][] = [
      ['오프라인', 'offline', 'signed_in', 'offline'],
      ['요청 한도', 'rate_limited', 'signed_in', 'rate_limited'],
      ['클라이언트 세션 만료', 'session_expired', 'signed_in', 'session_expired'],
      ['인증 세션 만료', 'online', 'expired', 'session_expired'],
      ['로그아웃', 'online', 'signed_out', 'signed_out'],
      ['로그인 중', 'online', 'signing_in', 'signed_out'],
      ['세션 만료가 오프라인보다 먼저', 'offline', 'expired', 'session_expired']
    ]

    it.each(cases)('%s', async (_name, status, state, reason) => {
      const { client, calls } = fakeClient(() => empty(204))
      vi.spyOn(client, 'getStatus').mockReturnValue(status)
      session = state
      const repoBefore = getRepository(db, 1)
      const threadBefore = getNotification(db, '100')
      const s = make(client)
      expect(s.getAvailability()).toEqual({ available: false, reason })
      expect(await s.star(1, true)).toEqual({ ok: false, reason })
      expect(await s.markRead('100')).toEqual({ ok: false, reason })
      expect(await s.markDone('100')).toEqual({ ok: false, reason })
      expect(calls).toEqual([])
      expect(notify).not.toHaveBeenCalled()
      expect(getRepository(db, 1)).toEqual(repoBefore)
      expect(getNotification(db, '100')).toEqual(threadBefore)
      expect(doneMarkers(db)).toEqual([])
    })

    it('온라인이고 로그인되어 있으면 사용 가능', () => {
      const { client } = fakeClient(() => empty(204))
      expect(make(client).getAvailability()).toEqual({ available: true })
    })
  })

  describe('같은 대상 연속 동작', () => {
    it('빠른 스타→취소는 순서대로 처리되고 최종 캐시가 원래 값과 같다', async () => {
      const before = getRepository(db, 1)
      const first = deferred()
      const { client, calls } = fakeClient((call) =>
        call.method === 'PUT' ? first.promise : empty(204)
      )
      const s = make(client)
      const a = s.star(1, true)
      const b = s.star(1, false)
      await vi.waitFor(() => expect(calls).toHaveLength(1))
      // 첫 요청이 끝나기 전에는 두 번째 동작이 캐시를 건드리지 않는다
      expect(getRepository(db, 1)).toMatchObject({ viewerHasStarred: true, stargazerCount: 11 })
      first.resolve(empty(204))
      expect(await a).toEqual({ ok: true })
      expect(await b).toEqual({ ok: true })
      expect(calls.map((c) => c.method)).toEqual(['PUT', 'DELETE'])
      expect(getRepository(db, 1)).toMatchObject({
        viewerHasStarred: false,
        stargazerCount: 10,
        starredAt: before?.starredAt ?? null
      })
    })

    it('첫 동작이 실패해도 두 번째 동작은 되돌린 값 위에서 처리된다', async () => {
      const before = getRepository(db, 1)
      const first = deferred()
      const { client, calls } = fakeClient((call) =>
        call.method === 'PUT' ? first.promise : empty(204)
      )
      const s = make(client)
      const a = s.star(1, true)
      const b = s.star(1, false)
      await vi.waitFor(() => expect(calls).toHaveLength(1))
      first.resolve(empty(500))
      expect(await a).toMatchObject({ ok: false, reason: 'failed' })
      expect(await b).toEqual({ ok: true })
      expect(calls.map((c) => c.method)).toEqual(['PUT', 'DELETE'])
      expect(getRepository(db, 1)).toEqual(before)
    })

    it('첫 동작의 네트워크 실패로 오프라인이 되면 두 번째 동작은 막힌다', async () => {
      const before = getRepository(db, 1)
      const { client, calls } = fakeClient(() => {
        throw new TypeError('offline')
      })
      const s = make(client)
      const a = s.star(1, true)
      const b = s.star(1, false)
      expect(await a).toMatchObject({ ok: false, reason: 'failed' })
      expect(await b).toEqual({ ok: false, reason: 'offline' })
      expect(calls).toHaveLength(1)
      expect(getRepository(db, 1)).toEqual(before)
    })

    it('같은 스레드의 읽음→완료도 순서대로 처리된다', async () => {
      const first = deferred()
      const { client, calls } = fakeClient((call) =>
        call.method === 'PATCH' ? first.promise : empty(204)
      )
      const s = make(client)
      const a = s.markRead('100')
      const b = s.markDone('100')
      await vi.waitFor(() => expect(calls).toHaveLength(1))
      expect(getNotification(db, '100')?.state).toBe('read')
      first.resolve(empty(205))
      expect(await a).toEqual({ ok: true })
      expect(await b).toEqual({ ok: true })
      expect(calls.map((c) => c.method)).toEqual(['PATCH', 'DELETE'])
      expect(getNotification(db, '100')).toBeNull()
      expect(doneMarkers(db)).toHaveLength(1)
    })

    it('같은 스레드 완료 두 번: 두 번째는 행이 없어도 기록을 망가뜨리지 않는다', async () => {
      const { client, calls } = fakeClient(() => empty(204))
      const s = make(client)
      const [a, b] = await Promise.all([s.markDone('100'), s.markDone('100')])
      expect(a).toEqual({ ok: true })
      expect(b).toEqual({ ok: true })
      expect(calls).toHaveLength(2)
      expect(getNotification(db, '100')).toBeNull()
      expect(doneMarkers(db)).toEqual([{ thread_id: '100', updated_at: '2026-10-10T00:00:00Z' }])
    })

    it('다른 대상은 서로 기다리지 않는다', async () => {
      const first = deferred()
      const { client, calls } = fakeClient((call) =>
        call.path.endsWith('/widget') ? first.promise : empty(204)
      )
      const s = make(client)
      const a = s.star(1, true)
      expect(await s.star(2, false)).toEqual({ ok: true })
      expect(calls).toHaveLength(2)
      first.resolve(empty(204))
      expect(await a).toEqual({ ok: true })
    })
  })

  describe('가용성 이벤트', () => {
    function controllableClient(): {
      client: ActionsClient
      setStatus: (s: ConnectionStatus) => void
    } {
      let status: ConnectionStatus = 'online'
      const listeners = new Set<(s: ConnectionStatus) => void>()
      const unused = async (): Promise<never> => {
        throw new Error('not used')
      }
      const client: ActionsClient = {
        put: unused,
        patch: unused,
        delete: unused,
        getStatus: () => status,
        onStatusChange: (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        }
      }
      return {
        client,
        setStatus: (s) => {
          status = s
          for (const l of listeners) l(s)
        }
      }
    }

    it('연결 상태·세션 변화에 바뀔 때만 알린다', () => {
      const { client, setStatus } = controllableClient()
      const authListeners = new Set<() => void>()
      service = createActionsService({
        db: () => db,
        client,
        getSession: () => ({ state: session }),
        notify,
        onAuthChanged: (l) => {
          authListeners.add(l)
          return () => authListeners.delete(l)
        }
      })
      const events: unknown[] = []
      service.onAvailabilityChange((a) => events.push(a))
      const authChanged = (): void => {
        for (const l of authListeners) l()
      }

      setStatus('offline')
      expect(events).toEqual([{ available: false, reason: 'offline' }])

      // 실제 변화가 없는 세션 알림은 무시
      authChanged()
      expect(events).toHaveLength(1)

      setStatus('rate_limited')
      setStatus('online')
      expect(events.slice(1)).toEqual([
        { available: false, reason: 'rate_limited' },
        { available: true }
      ])

      session = 'expired'
      setStatus('session_expired')
      authChanged()
      expect(events.slice(3)).toEqual([{ available: false, reason: 'session_expired' }])

      session = 'signed_out'
      setStatus('online')
      authChanged()
      expect(events.slice(4)).toEqual([{ available: false, reason: 'signed_out' }])

      session = 'signed_in'
      authChanged()
      expect(events.slice(5)).toEqual([{ available: true }])
    })

    it('dispose 뒤에는 구독을 끊는다', () => {
      const { client, setStatus } = controllableClient()
      const s = make(client)
      const listener = vi.fn()
      s.onAvailabilityChange(listener)
      s.dispose()
      service = null
      setStatus('offline')
      expect(listener).not.toHaveBeenCalled()
    })

    it('구독 해제 함수', () => {
      const { client, setStatus } = controllableClient()
      const s = make(client)
      const listener = vi.fn()
      const off = s.onAvailabilityChange(listener)
      off()
      setStatus('offline')
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
