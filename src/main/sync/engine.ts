import type { ConnectionStatus } from '@shared/domain/connection'
import { assertIssueRef } from '@shared/domain/issue-detail'
import type { IssueRef } from '@shared/domain/issue-detail'
import type { OrgRestrictionNotice } from '@shared/domain/org'
import type { SessionState } from '@shared/domain/session'
import { parseRefreshScope } from '@shared/domain/sync'
import type { RefreshScope, SyncStatus } from '@shared/domain/sync'

/**
 * 자동 갱신 엔진 (spec §6). 언제 무엇을 받을지만 정하고, 받기·저장은 주입된 refresh 함수가 한다.
 *
 * - 창이 하나 이상 열려 있고 로그인(signed_in)된 동안만 자동 갱신한다.
 * - 연결 상태가 online 이 아니면 멈춘다. offline 이면 주기적으로 연결을 확인하고,
 *   rate_limited 면 GitHub 가 알려 준 시각 뒤에 다시 본다. online 이 되면 바로 전체를 받는다.
 * - 같은 범위(unit)는 동시에 두 번 돌지 않는다. 진행 중인 갱신에 합친다.
 * - 한 갱신의 오류는 다른 갱신을 막지 않는다.
 * - 갱신이 끝나면 lastSyncedAt 을 바꾸고 data:changed 키를 알린다.
 *
 * Electron·DB 를 직접 쓰지 않는다(모두 주입). 실제 연결은 ./index.ts 의 initSync().
 */

export interface SyncIntervals {
  /** 알림 기본 주기. GitHub X-Poll-Interval 이 더 길면 그것을 따른다. 기본 60초 */
  notificationsMs: number
  /** 목록(내 저장소·스타·열린 항목·PR·이슈) 주기. 기본 5분 */
  listsMs: number
  /** 상세 추적 저장소 주기. 기본 5분 */
  detailsMs: number
  /** 오프라인일 때 연결 확인 주기. 기본 30초 */
  offlineProbeMs: number
  /** 한도 막힘이 풀리는 시각 뒤 여유. 기본 1초 */
  rateLimitMarginMs: number
  /** 한도 막힘인데 풀리는 시각을 모를 때 다시 볼 때까지. 기본 60초 */
  rateLimitFallbackMs: number
}

export const DEFAULT_SYNC_INTERVALS: SyncIntervals = {
  notificationsMs: 60_000,
  listsMs: 5 * 60_000,
  detailsMs: 5 * 60_000,
  offlineProbeMs: 30_000,
  rateLimitMarginMs: 1_000,
  rateLimitFallbackMs: 60_000
}

/** 수집 → 캐시 저장 함수들(T7 refresh*). 반환값 중 엔진이 쓰는 것만 적는다 */
export interface SyncRefreshers {
  notifications(): Promise<{ pollInterval: number | null }>
  repositories(pinnedRepoIds: readonly number[]): Promise<unknown>
  starred(): Promise<unknown>
  repoOpenItems(): Promise<{ repoIds: readonly number[] } | void>
  pullRequestLists(): Promise<unknown>
  issueLists(): Promise<unknown>
  /** 나를 언급한 이슈(검색). 할당·내 이슈와 따로 돌아 실패가 서로를 막지 않는다 */
  mentionedIssues(): Promise<unknown>
  repositoryDetail(repoId: number): Promise<unknown>
  /** 보고 있는 이슈 상세. 열 때 바로, 보는 동안 목록 주기로 */
  issueDetail(repoId: number, number: number): Promise<unknown>
  /** Home 기여 달력·커밋 기여 수(GraphQL). 목록 주기·home 범위 */
  contributions(): Promise<unknown>
  /** Home 최근 커밋(REST 커밋 검색, search 한도). 목록 주기·home 범위 */
  recentCommits(): Promise<unknown>
}

export interface SyncConnection {
  getStatus(): ConnectionStatus
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void
  checkConnectivity(): Promise<ConnectionStatus>
  getRateLimitedUntil(): number | null
  isRateLimitLow(resource: string): boolean
  getRateLimit?(resource: string): { remaining: number; limit: number; resetAt: number } | undefined
}

export interface SyncSession {
  state: SessionState
  inboxAvailable: boolean
}

export interface SyncScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SyncEngineOptions {
  refresh: SyncRefreshers
  connection: SyncConnection
  session: { get(): SyncSession; onChange(listener: (session: SyncSession) => void): () => void }
  pins: { list(): readonly number[]; onChange(listener: (repoIds: number[]) => void): () => void }
  /** 저장된 마지막 동기화 시각(재시작 직후 "N분 전 정보" 용) */
  readLastSyncedAt(): number | null
  readOrgRestrictions(): OrgRestrictionNotice[]
  notifyDataChanged(keys: string[]): void
  onStatus?(status: SyncStatus): void
  onError?(unit: string, error: unknown): void
  now?: () => number
  scheduler?: SyncScheduler
  intervals?: Partial<SyncIntervals>
  /** 상세 수집이 쓰는 한도 자원(GraphQL + 스타 시각 REST). 기본 ['graphql', 'core'] */
  detailRateLimitResources?: readonly string[]
  /** 목록 수집이 쓰는 한도 자원(GraphQL·검색 모두 GraphQL). 기본 ['graphql'] */
  listRateLimitResources?: readonly string[]
  /** 남은 양이 이 비율 미만이면 목록 갱신도 미룬다(상세는 isRateLimitLow 기준으로 먼저 미룬다). 기본 0.05 */
  listsLowRatio?: number
  /** 최근 커밋(커밋 검색)이 쓰는 한도 자원. 이 중 하나가 적으면(isRateLimitLow) 자동 갱신에서 그것만 미룬다. 기본 ['search'] */
  searchRateLimitResources?: readonly string[]
}

type GroupName = 'notifications' | 'lists' | 'details'

interface Group {
  timer: unknown
  dueAt: number
  running: boolean
}

const defaultScheduler: SyncScheduler = {
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

const KEYS = {
  notifications: ['inbox', 'home', 'sidebar'],
  repositories: ['repositories', 'sidebar', 'home', 'pulls', 'issues'],
  starred: ['starred'],
  repoOpenItems: ['pulls', 'issues', 'home', 'sidebar'],
  pullRequestLists: ['pulls', 'reviews', 'home', 'sidebar'],
  issueLists: ['issues', 'home'],
  mentionedIssues: ['issues'],
  contributions: ['home'],
  recentCommits: ['home']
} as const

type ListUnit =
  | 'repositories'
  | 'starred'
  | 'repoOpenItems'
  | 'pullRequestLists'
  | 'issueLists'
  | 'mentionedIssues'
  | 'contributions'
  | 'recentCommits'

function assertRepoId(repoId: unknown): asserts repoId is number {
  if (typeof repoId !== 'number' || !Number.isSafeInteger(repoId) || repoId <= 0) {
    throw new Error(`Invalid repository id: ${String(repoId)}`)
  }
}

function issueKey(ref: IssueRef): string {
  return `issue:${ref.repoId}#${ref.number}`
}

export class SyncEngine {
  private readonly intervals: SyncIntervals
  private readonly now: () => number
  private readonly scheduler: SyncScheduler
  private readonly detailResources: readonly string[]
  private readonly listResources: readonly string[]
  private readonly searchResources: readonly string[]
  private readonly listsLowRatio: number
  private readonly unsubscribers: (() => void)[] = []

  private windowsOpen = false
  private session: SyncSession
  private pinned: number[]
  private viewedRepoId: number | null = null
  private viewedIssue: IssueRef | null = null
  private lastSyncedAt: number | null
  /** 마지막 알림 요청 시각과 그때 받은 최소 간격(ms). 다시 켜질 때 GitHub 최소 간격을 지킨다 */
  private lastNotificationsAttempt = Number.NEGATIVE_INFINITY
  private lastNotificationsPollMs = 0

  /** 자동 갱신이 돌고 있는가(창·로그인·연결이 모두 맞을 때) */
  private running = false
  private disposed = false
  private readonly groups: Record<GroupName, Group> = {
    notifications: { timer: null, dueAt: 0, running: false },
    lists: { timer: null, dueAt: 0, running: false },
    details: { timer: null, dueAt: 0, running: false }
  }
  private probeTimer: unknown = null
  private probing = false
  private rateLimitTimer: unknown = null
  private readonly inflight = new Map<string, Promise<boolean>>()
  private lastEmitted: string | null = null

  constructor(private readonly options: SyncEngineOptions) {
    const intervals = { ...DEFAULT_SYNC_INTERVALS, ...options.intervals }
    // 0 이나 음수 주기로 쉬지 않고 요청하지 않게 막는다
    for (const key of ['notificationsMs', 'listsMs', 'detailsMs', 'offlineProbeMs'] as const) {
      intervals[key] = Math.max(1_000, intervals[key])
    }
    this.intervals = intervals
    this.now = options.now ?? Date.now
    this.scheduler = options.scheduler ?? defaultScheduler
    this.detailResources = options.detailRateLimitResources ?? ['graphql', 'core']
    this.listResources = options.listRateLimitResources ?? ['graphql']
    this.searchResources = options.searchRateLimitResources ?? ['search']
    this.listsLowRatio = options.listsLowRatio ?? 0.05
    this.session = { ...options.session.get() }
    this.pinned = [...options.pins.list()]
    // 세션 만료·로그인 중에도 저장된 정보를 보여 주므로 그 시각을 둔다. 로그아웃만 비운다
    this.lastSyncedAt = this.session.state === 'signed_out' ? null : this.safeLastSyncedAt()

    this.unsubscribers.push(
      options.connection.onStatusChange(() => {
        this.reconcile()
        this.emitStatus()
      }),
      options.session.onChange((session) => this.handleSession(session)),
      options.pins.onChange((repoIds) => this.handlePins(repoIds))
    )
    // 처음 상태는 sync:getStatus 로 읽는다. 바뀔 때만 알린다
    this.lastEmitted = JSON.stringify(this.getStatus())
  }

  // ───────────────────────── 공개 API ─────────────────────────

  /** 앱 창이 하나라도 열려 있는가. 연결 단계가 창 생성·닫힘에서 부른다 */
  setWindowsOpen(open: boolean): void {
    if (this.disposed || this.windowsOpen === open) return
    this.windowsOpen = open
    this.reconcile()
    this.emitStatus()
  }

  /**
   * 상세 화면 진입(repoId)·이탈(null). 진입하면 그 저장소 상세를 바로 받는다
   * (사용자가 연 화면이므로 한도가 적어도 받는다). 받기가 끝나면 끝나는 Promise.
   */
  async setViewedRepo(repoId: number | null): Promise<void> {
    if (repoId !== null) assertRepoId(repoId)
    const previous = this.viewedRepoId
    this.viewedRepoId = repoId
    if (repoId === null || repoId === previous || !this.canFetch()) return
    await this.runDetail(repoId)
  }

  /**
   * 이슈 상세 패널 열림(이슈)·닫힘(null). 열면 그 이슈를 바로 받고(한도가 적어도, 사용자가 연 패널),
   * 보는 동안 목록 주기마다 다시 받는다. 같은 이슈를 다시 알리면 받지 않는다. 받기가 끝나면 끝나는 Promise.
   */
  async setViewedIssue(ref: IssueRef | null): Promise<void> {
    if (ref !== null) assertIssueRef(ref)
    const previous = this.viewedIssue
    this.viewedIssue = ref === null ? null : { repoId: ref.repoId, number: ref.number }
    if (ref === null || !this.canFetch()) return
    if (previous && previous.repoId === ref.repoId && previous.number === ref.number) return
    await this.runIssueDetail(ref)
  }

  /** 상세 추적 집합 = 고정 + 보고 있는 저장소(중복 없음, 고정 순서 뒤에 보고 있는 저장소) */
  getTrackedRepoIds(): number[] {
    const ids = [...this.pinned]
    if (this.viewedRepoId !== null) ids.push(this.viewedRepoId)
    return [...new Set(ids)]
  }

  /**
   * 화면의 수동 새로고침. 그 화면에 필요한 정보를 바로 받는다. 오프라인이면 연결을 한 번 확인하고,
   * 그래도 online 이 아니거나 로그인 상태가 아니면 아무것도 하지 않는다.
   */
  async refresh(scope: RefreshScope): Promise<void> {
    const parsed = parseRefreshScope(scope)
    if (parsed === null) throw new Error(`Invalid refresh scope: ${String(scope)}`)
    if (this.disposed || this.session.state !== 'signed_in') return
    if (this.options.connection.getStatus() === 'offline') await this.probe()
    if (!this.canFetch()) return

    if (parsed.startsWith('repo:')) {
      await this.runDetail(Number(parsed.slice('repo:'.length)))
      return
    }
    switch (parsed) {
      case 'home':
        await this.runNotifications()
        await this.runUnit('pullRequestLists')
        await this.runUnit('repoOpenItems')
        await this.runUnit('contributions')
        await this.runUnit('recentCommits')
        for (const id of this.getTrackedRepoIds()) await this.runDetail(id)
        return
      case 'inbox':
        await this.runNotifications()
        return
      case 'pulls':
        await this.runUnit('pullRequestLists')
        await this.runUnit('repoOpenItems')
        return
      case 'reviews':
        await this.runUnit('pullRequestLists')
        return
      case 'issues':
        await this.runUnit('issueLists')
        await this.runUnit('mentionedIssues')
        await this.runUnit('repoOpenItems')
        if (this.viewedIssue) await this.runIssueDetail(this.viewedIssue)
        return
      case 'starred':
        await this.runUnit('starred')
        return
      case 'repositories':
        await this.runUnit('repositories')
        return
    }
  }

  getStatus(): SyncStatus {
    const connection = this.options.connection.getStatus()
    return {
      connection,
      lastSyncedAt: this.lastSyncedAt,
      rateLimitedUntil:
        connection === 'rate_limited' ? this.options.connection.getRateLimitedUntil() : null,
      syncing: this.inflight.size > 0,
      orgRestrictions: this.safeOrgRestrictions()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.unsubscribers.splice(0)) off()
    this.stopGroups()
    this.clearProbe()
    this.clearRateLimitTimer()
  }

  // ───────────────────────── 상태 전환 ─────────────────────────

  private isActive(): boolean {
    return !this.disposed && this.windowsOpen && this.session.state === 'signed_in'
  }

  /** 수동·진입 갱신을 지금 보낼 수 있는가 */
  private canFetch(): boolean {
    return (
      !this.disposed &&
      this.session.state === 'signed_in' &&
      this.options.connection.getStatus() === 'online'
    )
  }

  /** 창·로그인·연결 상태에 맞춰 자동 갱신을 켜고 끈다 */
  private reconcile(): void {
    if (!this.isActive()) {
      this.running = false
      this.stopGroups()
      this.clearProbe()
      this.clearRateLimitTimer()
      return
    }
    const status = this.options.connection.getStatus()
    if (status === 'online') {
      this.clearProbe()
      this.clearRateLimitTimer()
      if (!this.running) {
        this.running = true
        this.startGroups()
      }
      return
    }
    // 멈춤: 진행 중인 갱신은 끝까지 두고 다음 주기를 잡지 않는다
    this.running = false
    this.stopGroups()
    if (status === 'offline') {
      this.clearRateLimitTimer()
      this.armProbe()
    } else if (status === 'rate_limited') {
      this.clearProbe()
      this.armRateLimitTimer()
    } else {
      // session_expired: 다시 로그인하면 요청 계층이 online 을 알린다
      this.clearProbe()
      this.clearRateLimitTimer()
    }
  }

  private handleSession(session: SyncSession): void {
    if (this.disposed) return
    const previous = this.session
    this.session = { ...session }
    if (previous.state !== session.state) {
      // 로그아웃하면 캐시가 지워진다. 로그인하면 저장된 값을 다시 읽는다
      this.lastSyncedAt = session.state === 'signed_out' ? null : this.safeLastSyncedAt()
      this.reconcile()
    }
    this.emitStatus()
  }

  private handlePins(repoIds: readonly number[]): void {
    if (this.disposed) return
    const before = new Set(this.getTrackedRepoIds())
    this.pinned = [...repoIds]
    if (!this.running || this.detailsDeferred()) return
    for (const id of this.getTrackedRepoIds()) {
      if (!before.has(id)) void this.runDetail(id)
    }
  }

  // ───────────────────────── 주기 ─────────────────────────

  /** 다시 켜질 때: 목록·상세는 바로, 알림은 GitHub 최소 간격을 지킬 수 있으면 바로 */
  private startGroups(): void {
    const now = this.now()
    this.groups.lists.dueAt = now
    this.groups.details.dueAt = now
    this.groups.notifications.dueAt = Math.max(
      now,
      this.lastNotificationsAttempt + this.lastNotificationsPollMs
    )
    for (const name of ['notifications', 'lists', 'details'] as const) this.schedule(name)
  }

  private stopGroups(): void {
    for (const group of Object.values(this.groups)) {
      if (group.timer !== null) this.scheduler.clearTimeout(group.timer)
      group.timer = null
    }
  }

  private schedule(name: GroupName): void {
    const group = this.groups[name]
    if (group.timer !== null) this.scheduler.clearTimeout(group.timer)
    group.timer = null
    if (!this.running || group.running) return
    const delay = group.dueAt - this.now()
    if (delay <= 0) {
      void this.runGroup(name)
      return
    }
    group.timer = this.scheduler.setTimeout(() => {
      group.timer = null
      void this.runGroup(name)
    }, delay)
  }

  private intervalOf(name: GroupName): number {
    if (name === 'lists') return this.intervals.listsMs
    if (name === 'details') return this.intervals.detailsMs
    return this.intervals.notificationsMs
  }

  private async runGroup(name: GroupName): Promise<void> {
    const group = this.groups[name]
    if (!this.running || group.running) return
    group.running = true
    group.dueAt = this.now() + this.intervalOf(name)
    try {
      if (name === 'notifications') {
        await this.runNotifications()
        group.dueAt = Math.max(
          group.dueAt,
          this.lastNotificationsAttempt + this.lastNotificationsPollMs
        )
      } else if (name === 'lists') {
        if (!this.listsDeferred()) await this.runLists()
      } else if (!this.detailsDeferred()) {
        for (const id of this.getTrackedRepoIds()) {
          if (!this.running) break
          await this.runDetail(id)
        }
      }
    } finally {
      group.running = false
      this.schedule(name)
    }
  }

  private async runLists(): Promise<void> {
    // 열린 항목 수집은 캐시의 내 저장소 집합을 쓰므로 내 저장소를 먼저 받는다
    await this.runUnit('repositories')
    await this.runUnit('repoOpenItems')
    await this.runUnit('pullRequestLists')
    await this.runUnit('issueLists')
    await this.runUnit('mentionedIssues')
    // 보고 있는 이슈 상세는 목록 주기로 다시 받는다
    if (this.viewedIssue) await this.runIssueDetail(this.viewedIssue)
    await this.runUnit('starred')
    // Home 활동 영역. 실패(가짜 서버가 모르는 요청 등)는 execute 가 따로 삼킨다
    await this.runUnit('contributions')
    if (!this.searchDeferred()) await this.runUnit('recentCommits')
  }

  /** 커밋 검색 한도가 적으면 최근 커밋만 미룬다(검색 한도는 작고 다른 목록과 따로다) */
  private searchDeferred(): boolean {
    return this.searchResources.some((r) => this.options.connection.isRateLimitLow(r))
  }

  private detailsDeferred(): boolean {
    return this.detailResources.some((r) => this.options.connection.isRateLimitLow(r))
  }

  private listsDeferred(): boolean {
    const get = this.options.connection.getRateLimit
    if (!get) return false
    const now = this.now()
    return this.listResources.some((r) => {
      const info = get.call(this.options.connection, r)
      if (!info || info.limit <= 0 || now >= info.resetAt) return false
      return info.remaining / info.limit < this.listsLowRatio
    })
  }

  // ───────────────────────── 갱신 단위 ─────────────────────────

  private async runNotifications(): Promise<void> {
    if (!this.session.inboxAvailable) return
    await this.execute('notifications', async () => {
      this.lastNotificationsAttempt = this.now()
      const result = await this.options.refresh.notifications()
      const poll = result?.pollInterval
      this.lastNotificationsPollMs = Math.max(
        this.intervals.notificationsMs,
        typeof poll === 'number' && poll > 0 ? poll * 1000 : 0
      )
      return [...KEYS.notifications]
    })
    this.pushBackNotificationsPoll()
  }

  /**
   * 수동 새로고침을 포함해 알림을 요청했으면 다음 자동 폴링을 그 요청으로부터
   * max(기본 주기, X-Poll-Interval) 뒤로 민다(GitHub 최소 간격, 실패해도 같다).
   */
  private pushBackNotificationsPoll(): void {
    const group = this.groups.notifications
    const earliest =
      this.lastNotificationsAttempt +
      Math.max(this.intervals.notificationsMs, this.lastNotificationsPollMs)
    if (group.dueAt >= earliest) return
    group.dueAt = earliest
    if (!group.running) this.schedule('notifications')
  }

  private runUnit(unit: ListUnit): Promise<boolean> {
    const refresh = this.options.refresh
    switch (unit) {
      case 'repositories':
        return this.execute(unit, async () => {
          await refresh.repositories([...this.pinned])
          return [...KEYS.repositories]
        })
      case 'starred':
        return this.execute(unit, async () => {
          await refresh.starred()
          return [...KEYS.starred]
        })
      case 'repoOpenItems':
        return this.execute(unit, async () => {
          const result = await refresh.repoOpenItems()
          const ids = result ? result.repoIds : []
          return [...KEYS.repoOpenItems, ...ids.map((id) => `repo:${id}`)]
        })
      case 'pullRequestLists':
        return this.execute(unit, async () => {
          await refresh.pullRequestLists()
          return [...KEYS.pullRequestLists]
        })
      case 'issueLists':
        return this.execute(unit, async () => {
          await refresh.issueLists()
          return [...KEYS.issueLists]
        })
      case 'mentionedIssues':
        return this.execute(unit, async () => {
          await refresh.mentionedIssues()
          return [...KEYS.mentionedIssues]
        })
      case 'contributions':
        return this.execute(unit, async () => {
          await refresh.contributions()
          return [...KEYS.contributions]
        })
      case 'recentCommits':
        return this.execute(unit, async () => {
          await refresh.recentCommits()
          return [...KEYS.recentCommits]
        })
    }
  }

  private runDetail(repoId: number): Promise<boolean> {
    return this.execute(`detail:${repoId}`, async () => {
      await this.options.refresh.repositoryDetail(repoId)
      return [`repo:${repoId}`, 'home', 'sidebar']
    })
  }

  private runIssueDetail(ref: IssueRef): Promise<boolean> {
    const { repoId, number } = ref
    return this.execute(issueKey(ref), async () => {
      await this.options.refresh.issueDetail(repoId, number)
      return ['issues', issueKey(ref)]
    })
  }

  /** 같은 unit 이 진행 중이면 그 Promise 를 돌려준다. 오류는 삼키고 false */
  private execute(unit: string, task: () => Promise<string[]>): Promise<boolean> {
    const existing = this.inflight.get(unit)
    if (existing) return existing
    const promise = (async () => {
      await null
      try {
        const keys = await task()
        // 받는 사이 로그아웃했으면(캐시가 지워졌으면) 시각·알림을 남기지 않는다
        if (this.disposed || this.session.state !== 'signed_in') return true
        this.lastSyncedAt = this.now()
        this.options.notifyDataChanged(keys)
        return true
      } catch (error) {
        this.options.onError?.(unit, error)
        return false
      } finally {
        this.inflight.delete(unit)
        this.emitStatus()
      }
    })()
    this.inflight.set(unit, promise)
    this.emitStatus()
    return promise
  }

  // ───────────────────────── 연결 확인·한도 대기 ─────────────────────────

  private async probe(): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      await this.options.connection.checkConnectivity()
    } catch (error) {
      this.options.onError?.('connectivity', error)
    } finally {
      this.probing = false
    }
  }

  private armProbe(): void {
    if (this.probeTimer !== null) return
    this.probeTimer = this.scheduler.setTimeout(() => {
      this.probeTimer = null
      void this.probe().then(() => {
        this.reconcile()
        this.emitStatus()
      })
    }, this.intervals.offlineProbeMs)
  }

  private clearProbe(): void {
    if (this.probeTimer !== null) this.scheduler.clearTimeout(this.probeTimer)
    this.probeTimer = null
  }

  private armRateLimitTimer(): void {
    if (this.rateLimitTimer !== null) return
    const until = this.options.connection.getRateLimitedUntil()
    const delay =
      until === null
        ? this.intervals.rateLimitFallbackMs
        : Math.max(0, until - this.now()) + this.intervals.rateLimitMarginMs
    this.rateLimitTimer = this.scheduler.setTimeout(() => {
      this.rateLimitTimer = null
      this.reconcile()
      this.emitStatus()
    }, delay)
  }

  private clearRateLimitTimer(): void {
    if (this.rateLimitTimer !== null) this.scheduler.clearTimeout(this.rateLimitTimer)
    this.rateLimitTimer = null
  }

  // ───────────────────────── 상태 알림 ─────────────────────────

  private safeOrgRestrictions(): OrgRestrictionNotice[] {
    try {
      return this.options.readOrgRestrictions()
    } catch {
      return []
    }
  }

  private safeLastSyncedAt(): number | null {
    try {
      return this.options.readLastSyncedAt()
    } catch {
      return null
    }
  }

  private emitStatus(): void {
    if (this.disposed || !this.options.onStatus) return
    const status = this.getStatus()
    const serialized = JSON.stringify(status)
    if (serialized === this.lastEmitted) return
    this.lastEmitted = serialized
    this.options.onStatus(status)
  }
}
