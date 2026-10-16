import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { OrgRestrictionNotice } from '@shared/domain/org'
import type { SyncStatus } from '@shared/domain/sync'
import { SyncEngine } from './engine'
import type { SyncEngineOptions, SyncSession } from './engine'

const SEC = 1000
const MIN = 60 * SEC
const START = Date.UTC(2026, 9, 16, 9)

interface Harness {
  engine: SyncEngine
  calls: string[]
  notified: string[][]
  statuses: SyncStatus[]
  errors: string[]
  refresh: SyncEngineOptions['refresh']
  setStatus(status: ConnectionStatus): void
  /** 이벤트 없이 요청 계층의 상태만 바꾼다 */
  setStatusQuiet(status: ConnectionStatus): void
  setSession(patch: Partial<SyncSession>): void
  setPins(ids: number[]): void
  setLow(resources: string[]): void
  setRateLimit(resource: string, remaining: number, limit: number): void
  setRateLimitedUntil(until: number | null): void
  setPollInterval(seconds: number | null): void
  setOrgRestrictions(list: OrgRestrictionNotice[]): void
  probe: ReturnType<typeof vi.fn>
  count(name: string): number
}

function setup(
  init: {
    session?: Partial<SyncSession>
    pins?: number[]
    status?: ConnectionStatus
    lastSyncedAt?: number | null
    overrides?: Partial<SyncEngineOptions>
  } = {}
): Harness {
  const calls: string[] = []
  const notified: string[][] = []
  const statuses: SyncStatus[] = []
  const errors: string[] = []
  let status: ConnectionStatus = init.status ?? 'online'
  let session: SyncSession = { state: 'signed_in', inboxAvailable: true, ...init.session }
  let pins = init.pins ?? []
  let low = new Set<string>()
  const limits = new Map<string, { remaining: number; limit: number }>()
  let until: number | null = null
  let poll: number | null = null
  let orgs: OrgRestrictionNotice[] = []
  const statusListeners = new Set<(s: ConnectionStatus) => void>()
  const sessionListeners = new Set<(s: SyncSession) => void>()
  const pinListeners = new Set<(ids: number[]) => void>()

  const refresh: SyncEngineOptions['refresh'] = {
    notifications: vi.fn(async () => {
      calls.push('notifications')
      return { pollInterval: poll }
    }),
    repositories: vi.fn(async (pinned: readonly number[]) => {
      calls.push(`repositories[${pinned.join(',')}]`)
    }),
    starred: vi.fn(async () => {
      calls.push('starred')
    }),
    repoOpenItems: vi.fn(async () => {
      calls.push('repoOpenItems')
      return { repoIds: [7] }
    }),
    pullRequestLists: vi.fn(async () => {
      calls.push('pullRequestLists')
    }),
    issueLists: vi.fn(async () => {
      calls.push('issueLists')
    }),
    mentionedIssues: vi.fn(async () => {
      calls.push('mentionedIssues')
    }),
    issueDetail: vi.fn(async (repoId: number, number: number) => {
      calls.push(`issue:${repoId}#${number}`)
    }),
    repositoryDetail: vi.fn(async (repoId: number) => {
      calls.push(`detail:${repoId}`)
    }),
    contributions: vi.fn(async () => {
      calls.push('contributions')
    }),
    recentCommits: vi.fn(async () => {
      calls.push('recentCommits')
    })
  }
  const probe = vi.fn(async () => status)

  const engine = new SyncEngine({
    refresh,
    connection: {
      getStatus: () => status,
      onStatusChange: (l) => {
        statusListeners.add(l)
        return () => statusListeners.delete(l)
      },
      checkConnectivity: probe,
      getRateLimitedUntil: () => until,
      isRateLimitLow: (r) => low.has(r),
      getRateLimit: (r) => {
        const info = limits.get(r)
        return info ? { ...info, resetAt: Date.now() + 10 * MIN } : undefined
      }
    },
    session: {
      get: () => session,
      onChange: (l) => {
        sessionListeners.add(l)
        return () => sessionListeners.delete(l)
      }
    },
    pins: {
      list: () => pins,
      onChange: (l) => {
        pinListeners.add(l)
        return () => pinListeners.delete(l)
      }
    },
    readLastSyncedAt: () => init.lastSyncedAt ?? null,
    readOrgRestrictions: () => orgs,
    notifyDataChanged: (keys) => notified.push(keys),
    onStatus: (s) => statuses.push(s),
    onError: (unit) => errors.push(unit),
    ...init.overrides
  })

  return {
    engine,
    calls,
    notified,
    statuses,
    errors,
    refresh,
    probe,
    setStatus(next) {
      status = next
      for (const l of [...statusListeners]) l(next)
    },
    setStatusQuiet(next) {
      status = next
    },
    setSession(patch) {
      session = { ...session, ...patch }
      for (const l of [...sessionListeners]) l(session)
    },
    setPins(ids) {
      pins = ids
      for (const l of [...pinListeners]) l(ids)
    },
    setLow(resources) {
      low = new Set(resources)
    },
    setRateLimit(resource, remaining, limit) {
      limits.set(resource, { remaining, limit })
    },
    setRateLimitedUntil(next) {
      until = next
    },
    setPollInterval(seconds) {
      poll = seconds
    },
    setOrgRestrictions(list) {
      orgs = list
    },
    count(name) {
      return calls.filter((c) => c === name || c.startsWith(`${name}[`)).length
    }
  }
}

const FULL_ROUND = [
  'notifications',
  'repositories[]',
  'repoOpenItems',
  'pullRequestLists',
  'issueLists',
  'mentionedIssues',
  'starred',
  'contributions',
  'recentCommits'
]

/** 대기 중인 마이크로태스크(가짜 갱신 함수의 Promise)를 비운다 */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('SyncEngine', () => {
  let h: Harness | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })
  afterEach(() => {
    h?.engine.dispose()
    h = null
    vi.useRealTimers()
  })

  describe('창·로그인에 따른 시작과 멈춤', () => {
    it('창이 열려야 시작하고 모든 창이 닫히면 멈춘다', async () => {
      h = setup()
      await flush()
      expect(h.calls).toEqual([])

      h.engine.setWindowsOpen(true)
      await flush()
      expect([...h.calls].sort()).toEqual([...FULL_ROUND].sort())

      h.engine.setWindowsOpen(false)
      h.calls.length = 0
      await vi.advanceTimersByTimeAsync(30 * MIN)
      expect(h.calls).toEqual([])

      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('repositories')).toBe(1)
      expect(h.count('notifications')).toBe(1)
    })

    it('로그아웃하면 멈추고 로그인하면 다시 시작한다', async () => {
      h = setup({ session: { state: 'signed_out' } })
      h.engine.setWindowsOpen(true)
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.calls).toEqual([])

      h.setSession({ state: 'signed_in' })
      await flush()
      expect(h.count('notifications')).toBe(1)
      expect(h.count('repositories')).toBe(1)

      h.setSession({ state: 'signed_out' })
      h.calls.length = 0
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.calls).toEqual([])

      // 만료된 세션도 갱신하지 않는다(저장된 정보만 보여 준다)
      h.setSession({ state: 'expired' })
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.calls).toEqual([])
    })

    it('내 저장소 집합을 먼저 받은 뒤 열린 항목을 받는다(고정 ID 를 넘긴다)', async () => {
      h = setup({ pins: [5, 6] })
      h.engine.setWindowsOpen(true)
      await flush()
      const repos = h.calls.indexOf('repositories[5,6]')
      const items = h.calls.indexOf('repoOpenItems')
      expect(repos).toBeGreaterThanOrEqual(0)
      expect(items).toBeGreaterThan(repos)
    })
  })

  describe('주기', () => {
    it('알림 60초, 목록 5분, 상세 추적 5분', async () => {
      h = setup({ pins: [1] })
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('notifications')).toBe(1)
      expect(h.count('detail:1')).toBe(1)

      await vi.advanceTimersByTimeAsync(59 * SEC)
      expect(h.count('notifications')).toBe(1)
      await vi.advanceTimersByTimeAsync(1 * SEC)
      expect(h.count('notifications')).toBe(2)

      await vi.advanceTimersByTimeAsync(4 * MIN - 1)
      expect(h.count('repositories')).toBe(1)
      expect(h.count('detail:1')).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.count('notifications')).toBe(6)
      expect(h.count('repositories')).toBe(2)
      expect(h.count('repoOpenItems')).toBe(2)
      expect(h.count('pullRequestLists')).toBe(2)
      expect(h.count('issueLists')).toBe(2)
      expect(h.count('starred')).toBe(2)
      expect(h.count('contributions')).toBe(2)
      expect(h.count('recentCommits')).toBe(2)
      expect(h.count('detail:1')).toBe(2)
    })

    it('GitHub X-Poll-Interval 이 더 길면 그 간격을 지킨다', async () => {
      h = setup()
      h.setPollInterval(120)
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('notifications')).toBe(1)
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.count('notifications')).toBe(1)
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.count('notifications')).toBe(2)

      // 더 짧으면 기본 60초
      h.setPollInterval(30)
      await vi.advanceTimersByTimeAsync(120 * SEC)
      expect(h.count('notifications')).toBe(3)
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.count('notifications')).toBe(4)
    })

    it('수동 알림 새로고침은 다음 자동 폴링을 뒤로 민다(최소 간격 지킴)', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('notifications')).toBe(1)

      await vi.advanceTimersByTimeAsync(40 * SEC)
      await h.engine.refresh('inbox')
      expect(h.count('notifications')).toBe(2)
      // 원래 60초 자리에서는 폴링하지 않는다
      await vi.advanceTimersByTimeAsync(20 * SEC)
      expect(h.count('notifications')).toBe(2)
      // 수동 요청(40초)으로부터 60초 뒤
      await vi.advanceTimersByTimeAsync(40 * SEC - 1)
      expect(h.count('notifications')).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.count('notifications')).toBe(3)
    })

    it('home 새로고침도 알림 폴링을 밀고 X-Poll-Interval 을 따른다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      await vi.advanceTimersByTimeAsync(30 * SEC)
      h.setPollInterval(120)
      await h.engine.refresh('home')
      expect(h.count('notifications')).toBe(2)
      await vi.advanceTimersByTimeAsync(120 * SEC - 1)
      expect(h.count('notifications')).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.count('notifications')).toBe(3)
    })

    it('수동 알림 요청이 실패해도 다음 폴링은 최소 간격 뒤', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      await vi.advanceTimersByTimeAsync(50 * SEC)
      vi.mocked(h.refresh.notifications).mockRejectedValueOnce(new Error('x'))
      await h.engine.refresh('inbox')
      await vi.advanceTimersByTimeAsync(60 * SEC - 1)
      expect(h.refresh.notifications).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.refresh.notifications).toHaveBeenCalledTimes(3)
    })

    it('간격을 바꿀 수 있다', async () => {
      h = setup({ overrides: { intervals: { notificationsMs: 2 * MIN, listsMs: 10 * MIN } } })
      h.engine.setWindowsOpen(true)
      await flush()
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('notifications')).toBe(3)
      expect(h.count('repositories')).toBe(1)
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('repositories')).toBe(2)
    })

    it('inboxAvailable 이 false 면 알림을 받지 않는다(수동 새로고침 포함)', async () => {
      h = setup({ session: { inboxAvailable: false } })
      h.engine.setWindowsOpen(true)
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.count('notifications')).toBe(0)
      expect(h.count('repositories')).toBe(3)

      await h.engine.refresh('inbox')
      await h.engine.refresh('home')
      expect(h.count('notifications')).toBe(0)
      expect(h.count('pullRequestLists')).toBeGreaterThan(3)

      // 권한이 생기면 다음 주기부터 받는다
      h.setSession({ inboxAvailable: true })
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.count('notifications')).toBeGreaterThanOrEqual(1)
    })
  })

  describe('상세 추적 집합', () => {
    it('보고 있는 저장소에 들어가면 바로 상세를 받고, 주기에 포함한다', async () => {
      h = setup({ pins: [1] })
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.engine.getTrackedRepoIds()).toEqual([1])

      await h.engine.setViewedRepo(3)
      expect(h.count('detail:3')).toBe(1)
      expect(h.engine.getTrackedRepoIds()).toEqual([1, 3])

      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('detail:1')).toBe(2)
      expect(h.count('detail:3')).toBe(2)

      await h.engine.setViewedRepo(null)
      expect(h.engine.getTrackedRepoIds()).toEqual([1])
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('detail:1')).toBe(3)
      expect(h.count('detail:3')).toBe(2)
    })

    it('고정한 저장소를 다시 보면 집합에 한 번만 들어간다', async () => {
      h = setup({ pins: [1, 2] })
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedRepo(2)
      expect(h.engine.getTrackedRepoIds()).toEqual([1, 2])
    })

    it('고정이 바뀌면 집합을 바꾸고 새로 고정한 저장소는 바로 받는다', async () => {
      h = setup({ pins: [1] })
      h.engine.setWindowsOpen(true)
      await flush()
      h.setPins([1, 4])
      await flush()
      expect(h.count('detail:4')).toBe(1)
      expect(h.count('detail:1')).toBe(1)
      expect(h.engine.getTrackedRepoIds()).toEqual([1, 4])

      h.setPins([4])
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('detail:1')).toBe(1)
      expect(h.count('detail:4')).toBe(2)
      // 목록 갱신에는 바뀐 고정 ID 를 넘긴다
      expect(h.calls).toContain('repositories[4]')
    })

    it('멈춰 있을 때 저장소에 들어가면 받지 않는다', async () => {
      h = setup({ status: 'offline' })
      h.engine.setWindowsOpen(true)
      await h.engine.setViewedRepo(9)
      expect(h.count('detail:9')).toBe(0)
      expect(h.engine.getTrackedRepoIds()).toEqual([9])
    })

    it('로그아웃하면 보고 있던 저장소를 잊는다(다음 로그인에서 이전 계정의 상세를 받지 않는다)', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedRepo(9)
      expect(h.count('detail:9')).toBe(1)
      h.setSession({ state: 'signed_out' })
      expect(h.engine.getTrackedRepoIds()).toEqual([])
      h.setSession({ state: 'signed_in' })
      await flush()
      await vi.advanceTimersByTimeAsync(10 * MIN)
      await h.engine.refresh('home')
      expect(h.count('detail:9')).toBe(1)
    })

    it('계정 전환으로 계정 데이터가 지워지면 보고 있던 저장소를 잊는다', async () => {
      let cleared: (() => void) | null = null
      h = setup({
        pins: [1],
        overrides: {
          onAccountDataCleared: (listener) => {
            cleared = listener
            return () => {
              cleared = null
            }
          }
        }
      })
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedRepo(9)
      expect(h.engine.getTrackedRepoIds()).toEqual([1, 9])
      cleared!()
      expect(h.engine.getTrackedRepoIds()).toEqual([1])
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('detail:9')).toBe(1)
      // 같은 저장소를 다시 열면(새 계정에서) 다시 받는다
      await h.engine.setViewedRepo(9)
      expect(h.count('detail:9')).toBe(2)
    })

    it('잘못된 저장소 ID 는 거절한다', async () => {
      h = setup()
      await expect(h.engine.setViewedRepo(-1)).rejects.toThrow()
      await expect(h.engine.setViewedRepo(1.5)).rejects.toThrow()
    })
  })

  describe('보고 있는 이슈', () => {
    it('열면 바로 받고, 보는 동안 목록 주기로 다시 받고, 닫으면 멈춘다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('issue:5#12')).toBe(0)

      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(h.count('issue:5#12')).toBe(1)
      expect(h.notified.at(-1)).toEqual(expect.arrayContaining(['issues', 'issue:5#12']))

      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('issue:5#12')).toBe(2)
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('issue:5#12')).toBe(3)

      await h.engine.setViewedIssue(null)
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.count('issue:5#12')).toBe(3)
    })

    it('같은 이슈를 다시 알려도 또 받지 않고, 다른 이슈로 바꾸면 그것을 받는다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(h.count('issue:5#12')).toBe(1)
      await h.engine.setViewedIssue({ repoId: 5, number: 13 })
      expect(h.count('issue:5#13')).toBe(1)
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('issue:5#12')).toBe(1)
      expect(h.count('issue:5#13')).toBe(2)
    })

    it('오프라인이면 받지 않고, online 이 되면 목록과 함께 받는다', async () => {
      h = setup({ status: 'offline' })
      h.engine.setWindowsOpen(true)
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(h.count('issue:5#12')).toBe(0)
      h.setStatus('online')
      await flush()
      expect(h.count('issue:5#12')).toBe(1)
    })

    it('창이 닫혀 있어도 열 때 한 번은 받는다(사용자가 연 패널)', async () => {
      h = setup()
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(h.count('issue:5#12')).toBe(1)
    })

    it('issues 수동 새로고침은 보고 있는 이슈도 받는다', async () => {
      h = setup()
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      h.calls.length = 0
      await h.engine.refresh('issues')
      expect([...h.calls].sort()).toEqual(
        ['issueLists', 'mentionedIssues', 'repoOpenItems', 'issue:5#12'].sort()
      )
    })

    it('로그아웃하면 보고 있던 이슈를 잊는다(다음 로그인에서 이전 계정의 이슈를 받지 않는다)', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(h.count('issue:5#12')).toBe(1)
      h.setSession({ state: 'signed_out' })
      h.setSession({ state: 'signed_in' })
      await flush()
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.count('repositories')).toBeGreaterThan(1)
      expect(h.count('issue:5#12')).toBe(1)
      await h.engine.refresh('issues')
      expect(h.count('issue:5#12')).toBe(1)
    })

    it('계정 전환으로 계정 데이터가 지워지면 보고 있던 이슈를 잊는다', async () => {
      let cleared: (() => void) | null = null
      h = setup({
        overrides: {
          onAccountDataCleared: (listener) => {
            cleared = listener
            return () => {
              cleared = null
            }
          }
        }
      })
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(cleared).not.toBeNull()
      cleared!()
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('issue:5#12')).toBe(1)
      // 같은 이슈를 다시 열면(새 계정에서) 다시 받는다
      await h.engine.setViewedIssue({ repoId: 5, number: 12 })
      expect(h.count('issue:5#12')).toBe(2)
    })

    it('잘못된 이슈 키는 거절한다', async () => {
      h = setup()
      await expect(h.engine.setViewedIssue({ repoId: 0, number: 1 })).rejects.toThrow()
      await expect(h.engine.setViewedIssue({ repoId: 1, number: -1 })).rejects.toThrow()
      await expect(h.engine.setViewedIssue({ repoId: 1, number: 2.5 })).rejects.toThrow()
    })

    it('언급 목록 실패는 다른 목록을 막지 않는다', async () => {
      h = setup()
      ;(h.refresh.mentionedIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('unknown operation')
      )
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.errors).toContain('mentionedIssues')
      expect(h.count('starred')).toBe(1)
      expect(h.count('contributions')).toBe(1)
    })
  })

  describe('요청 한도', () => {
    it('남은 양이 적으면 상세 추적 갱신을 먼저 미룬다', async () => {
      h = setup({ pins: [1] })
      h.setLow(['graphql'])
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('detail:1')).toBe(0)
      expect(h.count('repositories')).toBe(1)
      expect(h.count('notifications')).toBe(1)

      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('detail:1')).toBe(0)
      expect(h.count('repositories')).toBe(2)

      // 한도가 다시 차면 다음 주기에 받는다
      h.setLow([])
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('detail:1')).toBe(1)
    })

    it('더 적어지면 목록 갱신도 미룬다(알림은 계속)', async () => {
      h = setup({ pins: [1] })
      h.setLow(['graphql'])
      h.setRateLimit('graphql', 100, 5000) // 2% < 기본 5%
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('detail:1')).toBe(0)
      expect(h.count('repositories')).toBe(0)
      expect(h.count('contributions')).toBe(0)
      expect(h.count('recentCommits')).toBe(0)
      expect(h.count('notifications')).toBe(1)

      h.setRateLimit('graphql', 400, 5000) // 8%: 상세만 미룬다
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('repositories')).toBe(1)
      expect(h.count('detail:1')).toBe(0)
    })

    it('검색 한도가 적으면 최근 커밋만 미룬다(기여 달력·다른 목록은 받는다)', async () => {
      h = setup()
      h.setLow(['search'])
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.count('recentCommits')).toBe(0)
      expect(h.count('contributions')).toBe(1)
      expect(h.count('repositories')).toBe(1)

      h.setLow([])
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(h.count('recentCommits')).toBe(1)
    })

    it('사용자가 연 저장소는 한도가 적어도 받는다', async () => {
      h = setup()
      h.setLow(['graphql'])
      h.engine.setWindowsOpen(true)
      await flush()
      await h.engine.setViewedRepo(3)
      expect(h.count('detail:3')).toBe(1)
    })
  })

  describe('연결 상태', () => {
    it('오프라인이면 멈추고 30초마다 연결을 확인하며, 돌아오면 바로 갱신한다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      h.calls.length = 0

      h.setStatus('offline')
      await vi.advanceTimersByTimeAsync(29 * SEC)
      expect(h.probe).toHaveBeenCalledTimes(0)
      await vi.advanceTimersByTimeAsync(1 * SEC)
      expect(h.probe).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.probe).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.calls).toEqual([])

      h.setStatus('online')
      await flush()
      expect([...h.calls].sort()).toEqual([...FULL_ROUND].sort())
      const probes = h.probe.mock.calls.length
      await vi.advanceTimersByTimeAsync(2 * MIN)
      expect(h.probe).toHaveBeenCalledTimes(probes)
    })

    it('연결 확인이 online 을 돌려주면 이벤트 없이도 재개한다', async () => {
      h = setup({ status: 'offline' })
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.calls).toEqual([])
      h.probe.mockImplementationOnce(async () => {
        h?.setStatusQuiet('online')
        return 'online'
      })
      await vi.advanceTimersByTimeAsync(30 * SEC)
      expect(h.count('notifications')).toBe(1)
    })

    it('연결 확인이 실패해도 계속 확인한다', async () => {
      h = setup({ status: 'offline' })
      h.engine.setWindowsOpen(true)
      h.probe.mockImplementationOnce(async () => {
        throw new Error('boom')
      })
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.probe).toHaveBeenCalledTimes(2)
    })

    it('한도 막힘이면 GitHub 가 알려 준 시각 뒤에 재개한다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      h.calls.length = 0

      h.setRateLimitedUntil(Date.now() + 90 * SEC)
      h.setStatus('rate_limited')
      await vi.advanceTimersByTimeAsync(80 * SEC)
      expect(h.calls).toEqual([])
      expect(h.engine.getStatus()).toMatchObject({
        connection: 'rate_limited',
        rateLimitedUntil: START + 90 * SEC
      })

      // 막힘이 풀리면 요청 계층의 상태가 online 이 된다(이벤트가 없어도 다시 읽는다)
      h.setRateLimitedUntil(null)
      h.setStatusQuiet('online')
      await vi.advanceTimersByTimeAsync(11 * SEC)
      expect(h.count('notifications')).toBe(1)
      expect(h.count('repositories')).toBe(1)
    })

    it('세션 만료면 멈추고 재로그인(online)에서 재개한다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      h.calls.length = 0
      h.setStatus('session_expired')
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.calls).toEqual([])
      expect(h.probe).not.toHaveBeenCalled()
      h.setStatus('online')
      await flush()
      expect(h.count('notifications')).toBe(1)
    })
  })

  describe('수동 새로고침', () => {
    it('화면마다 필요한 정보를 바로 받는다', async () => {
      h = setup({ pins: [1] })
      const cases: [Parameters<SyncEngine['refresh']>[0], string[]][] = [
        ['inbox', ['notifications']],
        ['pulls', ['pullRequestLists', 'repoOpenItems']],
        ['reviews', ['pullRequestLists']],
        ['issues', ['issueLists', 'mentionedIssues', 'repoOpenItems']],
        ['starred', ['starred']],
        ['repositories', ['repositories[1]']],
        ['repo:42', ['detail:42']],
        [
          'home',
          [
            'notifications',
            'pullRequestLists',
            'repoOpenItems',
            'contributions',
            'recentCommits',
            'detail:1'
          ]
        ]
      ]
      for (const [scope, expected] of cases) {
        h.calls.length = 0
        await h.engine.refresh(scope)
        expect([...h.calls].sort(), scope).toEqual([...expected].sort())
      }
    })

    it('로그인 안 했거나 한도 막힘이면 받지 않는다', async () => {
      h = setup({ session: { state: 'signed_out' } })
      await h.engine.refresh('inbox')
      expect(h.calls).toEqual([])
      h.setSession({ state: 'signed_in' })
      h.setStatus('rate_limited')
      await h.engine.refresh('inbox')
      expect(h.calls).toEqual([])
    })

    it('오프라인이면 연결을 한 번 확인하고, 돌아왔으면 받는다', async () => {
      h = setup({ status: 'offline' })
      await h.engine.refresh('inbox')
      expect(h.probe).toHaveBeenCalledTimes(1)
      expect(h.calls).toEqual([])
      h.probe.mockImplementationOnce(async () => {
        h?.setStatusQuiet('online')
        return 'online'
      })
      await h.engine.refresh('inbox')
      expect(h.calls).toEqual(['notifications'])
    })

    it('잘못된 범위는 거절한다', async () => {
      h = setup()
      await expect(h.engine.refresh('nope' as never)).rejects.toThrow()
    })
  })

  describe('동시 실행', () => {
    it('같은 범위는 동시에 두 번 돌지 않고 진행 중인 갱신에 합친다', async () => {
      h = setup()
      let release: () => void = () => {}
      vi.mocked(h.refresh.notifications).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ pollInterval: null })
          })
      )
      const a = h.engine.refresh('inbox')
      const b = h.engine.refresh('inbox')
      const c = h.engine.refresh('home')
      await flush()
      expect(h.refresh.notifications).toHaveBeenCalledTimes(1)
      expect(h.engine.getStatus().syncing).toBe(true)
      release()
      await Promise.all([a, b, c])
      expect(h.refresh.notifications).toHaveBeenCalledTimes(1)
      expect(h.engine.getStatus().syncing).toBe(false)

      // 끝난 뒤에는 다시 받을 수 있다
      await h.engine.refresh('inbox')
      expect(h.refresh.notifications).toHaveBeenCalledTimes(2)
    })

    it('상세는 저장소마다 합친다', async () => {
      h = setup({ pins: [1, 2] })
      let release: () => void = () => {}
      vi.mocked(h.refresh.repositoryDetail).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(undefined)
          })
      )
      const a = h.engine.refresh('repo:1')
      const b = h.engine.refresh('home')
      await flush()
      release()
      await Promise.all([a, b])
      expect(vi.mocked(h.refresh.repositoryDetail).mock.calls.map((c) => c[0])).toEqual([1, 2])
    })

    it('한 갱신의 오류가 다른 갱신을 막지 않는다', async () => {
      h = setup({ pins: [1] })
      vi.mocked(h.refresh.repositories).mockRejectedValue(new Error('down'))
      vi.mocked(h.refresh.notifications).mockRejectedValueOnce(new Error('down'))
      h.engine.setWindowsOpen(true)
      await flush()
      expect(h.errors.sort()).toEqual(['notifications', 'repositories'])
      expect(h.count('repoOpenItems')).toBe(1)
      expect(h.count('pullRequestLists')).toBe(1)
      expect(h.count('detail:1')).toBe(1)
      // 주기는 계속 돈다
      await vi.advanceTimersByTimeAsync(60 * SEC)
      expect(h.count('notifications')).toBe(1)
      expect(h.refresh.notifications).toHaveBeenCalledTimes(2)
    })
  })

  describe('갱신 뒤 알림과 상태', () => {
    it('범위별로 data:changed 키를 알린다', async () => {
      h = setup({ pins: [1] })
      await h.engine.refresh('inbox')
      await h.engine.refresh('repositories')
      await h.engine.refresh('starred')
      await h.engine.refresh('reviews')
      await h.engine.refresh('issues')
      await h.engine.refresh('repo:1')
      const sorted = h.notified.map((k) => [...k].sort())
      expect(sorted).toEqual([
        ['home', 'inbox', 'sidebar'],
        ['home', 'issues', 'pulls', 'repositories', 'sidebar'],
        ['starred'],
        ['home', 'pulls', 'reviews', 'sidebar'],
        ['home', 'issues'],
        ['issues'],
        ['home', 'issues', 'pulls', 'repo:7', 'sidebar'],
        ['home', 'repo:1', 'sidebar']
      ])
    })

    it('home 범위는 기여 달력·최근 커밋도 받고 home 을 알린다(실패는 따로 삼킨다)', async () => {
      h = setup()
      vi.mocked(h.refresh.recentCommits).mockRejectedValueOnce(new Error('404'))
      await h.engine.refresh('home')
      expect(h.refresh.contributions).toHaveBeenCalledTimes(1)
      expect(h.refresh.recentCommits).toHaveBeenCalledTimes(1)
      expect(h.errors).toEqual(['recentCommits'])
      // 기여 달력은 home 만 알린다. 실패한 최근 커밋은 알리지 않는다
      expect(h.notified).toContainEqual(['home'])
      expect(h.notified.filter((k) => k.length === 1 && k[0] === 'home')).toHaveLength(1)
      expect(h.count('pullRequestLists')).toBe(1)
    })

    it('실패한 갱신은 알리지 않고 lastSyncedAt 도 바꾸지 않는다', async () => {
      h = setup()
      vi.mocked(h.refresh.starred).mockRejectedValueOnce(new Error('x'))
      await h.engine.refresh('starred')
      expect(h.notified).toEqual([])
      expect(h.engine.getStatus().lastSyncedAt).toBeNull()
    })

    it('상태: 마지막 동기화 시각·진행 중·한도 대기·조직 제한', async () => {
      const org: OrgRestrictionNotice = {
        orgLogin: 'acme',
        reason: 'oauth_app_restriction',
        message: 'restricted',
        recordedAt: START
      }
      h = setup({ lastSyncedAt: START - 5 * MIN })
      expect(h.engine.getStatus()).toEqual({
        connection: 'online',
        lastSyncedAt: START - 5 * MIN,
        rateLimitedUntil: null,
        syncing: false,
        orgRestrictions: []
      })
      vi.setSystemTime(START + 10 * SEC)
      h.setOrgRestrictions([org])
      await h.engine.refresh('starred')
      const last = h.statuses.at(-1)
      expect(last).toEqual({
        connection: 'online',
        lastSyncedAt: START + 10 * SEC,
        rateLimitedUntil: null,
        syncing: false,
        orgRestrictions: [org]
      })
      expect(h.statuses.some((s) => s.syncing)).toBe(true)

      const before = h.statuses.length
      h.setStatus('offline')
      expect(h.statuses.length).toBe(before + 1)
      expect(h.statuses.at(-1)?.connection).toBe('offline')
    })

    it('같은 상태는 다시 보내지 않는다', async () => {
      h = setup()
      h.engine.setWindowsOpen(false)
      h.engine.setWindowsOpen(false)
      const n = h.statuses.length
      h.setStatus('online')
      expect(h.statuses.length).toBe(n)
    })

    it('세션 만료·로그인 중에는 저장된 정보의 시각을 유지한다(시작 때 포함)', async () => {
      h = setup({ lastSyncedAt: START - 3 * MIN })
      h.setSession({ state: 'expired' })
      expect(h.engine.getStatus().lastSyncedAt).toBe(START - 3 * MIN)
      h.setSession({ state: 'signing_in' })
      expect(h.engine.getStatus().lastSyncedAt).toBe(START - 3 * MIN)
      h.engine.dispose()

      h = setup({ session: { state: 'expired' }, lastSyncedAt: START - 7 * MIN })
      expect(h.engine.getStatus().lastSyncedAt).toBe(START - 7 * MIN)
      h.engine.dispose()

      h = setup({ session: { state: 'signing_in' }, lastSyncedAt: START - 8 * MIN })
      expect(h.engine.getStatus().lastSyncedAt).toBe(START - 8 * MIN)
      h.engine.dispose()

      h = setup({ session: { state: 'signed_out' }, lastSyncedAt: START - 9 * MIN })
      expect(h.engine.getStatus().lastSyncedAt).toBeNull()
    })

    it('로그아웃하면 마지막 동기화 시각을 비운다', async () => {
      h = setup({ lastSyncedAt: START })
      h.setSession({ state: 'signed_out' })
      expect(h.engine.getStatus().lastSyncedAt).toBeNull()
    })

    it('dispose 뒤에는 아무것도 하지 않는다', async () => {
      h = setup()
      h.engine.setWindowsOpen(true)
      await flush()
      h.engine.dispose()
      h.calls.length = 0
      h.setStatus('offline')
      h.setStatus('online')
      await vi.advanceTimersByTimeAsync(10 * MIN)
      expect(h.calls).toEqual([])
    })
  })
})
