import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURE, buildFixtures } from './data'
import type { FixtureState } from './data'
import { createBareRepos, readGitFile } from './git'
import { MUTATION_OPERATIONS, handleGraphQL } from './graphql'
import type { GraphQLBody } from './graphql'
import { handleRest } from './rest'
import type { FakeResponse, RestContext } from './rest'

/**
 * 화면 자동 테스트용 가짜 GitHub 서버 (spec §13). 127.0.0.1 의 임의 포트에서 진짜 HTTP 로 응답한다.
 * - `/api/**`: GitHub API. GraphQL(`POST /api/graphql`)은 operationName 으로, REST 는 메서드+경로로 고른다.
 * - `/web/**`: github.com 웹. 기기 인증(device flow)과 브라우저로 열 주소.
 * 테스트는 같은 프로세스에서 이 객체의 메서드로 서버를 조종한다(오프라인, 401, 쓰기 실패 등).
 */

export type Area = 'api' | 'web' | 'other'

export interface RecordedRequest {
  /** 받은 순서(1부터) */
  seq: number
  method: string
  area: Area
  /** 영역 기준 경로(쿼리 제외). 예: '/user', '/graphql', '/login/device/code' */
  path: string
  query: Record<string, string>
  /**
   * 찾기 쉬운 이름. REST 는 'GET /user', GraphQL 은 'GRAPHQL GdeskMyRepositories',
   * 웹은 'WEB POST /login/device/code'.
   */
  key: string
  operationName?: string
  variables?: Record<string, unknown>
  /** 요청 본문(JSON 이면 파싱한 값, 폼이면 객체, 아니면 문자열) */
  body?: unknown
  /** 소문자 이름. authorization 은 빠진다(토큰은 token 에) */
  headers: Record<string, string>
  /** Authorization: Bearer 값. 없으면 null */
  token: string | null
  /** 서버가 보낸 상태 코드(응답 전이면 undefined) */
  status?: number
  at: number
}

export type RequestMatcher = string | ((request: RecordedRequest) => boolean)

export type DeviceFlowOutcome = 'pending' | 'approve' | 'deny' | 'expire' | 'slow_down'

export interface FaultOptions {
  /** 응답 상태. 기본 500 */
  status?: number
  /** 이 조건에 맞는 요청만 실패시킨다. 기본: 모든 /api 요청 */
  match?: RequestMatcher
  /** 응답 본문 */
  body?: unknown
  /** 추가 헤더 */
  headers?: Record<string, string>
}

export interface StartFakeGitHubOptions {
  /** 고정 데이터의 기준 시각(ms). 기본 Date.now() */
  now?: number
  /** 데이터를 고칠 기회(시작·reset 때마다 불린다) */
  customize?: (state: FixtureState) => void
  /**
   * 클론용 bare 저장소를 만들 저장소 이름들(owner/name). 각각 `{webBase}/{owner}/{name}.git` 에서
   * git dumb HTTP 로 클론할 수 있다. 기본: 만들지 않음
   */
  gitRepos?: readonly string[]
}

interface Waiter {
  match: (r: RecordedRequest) => boolean
  resolve: (r: RecordedRequest) => void
  reject: (error: Error) => void
}

interface Fault {
  remaining: number
  status: number
  match: (r: RecordedRequest) => boolean
  body?: unknown
  headers?: Record<string, string>
}

const DEFAULT_RATE_LIMIT = 5000

/** 쓰기로 보지 않는 POST(읽기 전용 변환): 마크다운 미리보기 */
const READ_ONLY_POSTS: readonly string[] = ['POST /markdown']

/**
 * 쓰기 요청: GET·HEAD 가 아닌 REST /api 요청(`POST /markdown` 미리보기 제외)과 GraphQL mutation
 * (GdeskAddReaction·GdeskRemoveReaction·GdeskAddComment·GdeskCloseIssue·GdeskReopenIssue).
 * GraphQL 조회(query)는 쓰기가 아니다.
 */
export function isWriteRequest(r: RecordedRequest): boolean {
  if (r.area !== 'api') return false
  if (r.key.startsWith('GRAPHQL')) return MUTATION_OPERATIONS.includes(r.operationName ?? '')
  return r.method !== 'GET' && r.method !== 'HEAD' && !READ_ONLY_POSTS.includes(r.key)
}

function toMatcher(match: RequestMatcher): (r: RecordedRequest) => boolean {
  return typeof match === 'string' ? (r) => r.key === match : match
}

export class FakeGitHub {
  readonly origin: string
  /** GDESK_TEST_API_BASE 로 넘길 값 */
  readonly apiBase: string
  /** GDESK_TEST_WEB_BASE 로 넘길 값 */
  readonly webBase: string
  readonly port: number
  /** 지금의 데이터. 테스트가 직접 고쳐도 된다(다음 응답부터 반영) */
  state: FixtureState

  private readonly server: Server
  private readonly sockets = new Set<Socket>()
  private readonly options: StartFakeGitHubOptions
  private readonly fixtureNow: number
  /** gitRepos 로 만든 bare 저장소들의 폴더(없으면 null) */
  readonly gitRoot: string | null
  private recorded: RecordedRequest[] = []
  private seq = 0
  private waiters: Waiter[] = []

  private offline = false
  private unauthorized = false
  private faults: Fault[] = []
  private delayMs = 0
  private scopes: string | null = FIXTURE.scopes
  private fineGrained = false
  private pollInterval = 60
  private notificationsChangedAt: number
  private deviceOutcome: DeviceFlowOutcome = 'pending'
  private rateLimit = { limit: DEFAULT_RATE_LIMIT, remaining: null as number | null }
  /** 1차 한도 초과 흉내. 켜져 있으면 /api 요청이 403 + remaining 0, 이 시각(epoch 초)에 풀린다 */
  private rateLimitedUntil: number | null = null
  /** 앱에서 만든 이슈가 검색에 나오기까지의 지연(ms). null 이면 indexCreatedIssues() 까지 나오지 않는다 */
  private searchIndexDelayMs: number | null = null
  private readonly used = new Map<string, number>()

  /** startFakeGitHub() 로 만든다 */
  constructor(
    server: Server,
    port: number,
    options: StartFakeGitHubOptions,
    gitRoot: string | null = null
  ) {
    this.server = server
    this.gitRoot = gitRoot
    this.port = port
    this.options = options
    this.origin = `http://127.0.0.1:${port}`
    this.apiBase = `${this.origin}/api`
    this.webBase = `${this.origin}/web`
    this.fixtureNow = options.now ?? Date.now()
    this.state = this.freshState()
    this.notificationsChangedAt = this.fixtureNow
    server.on('connection', (socket) => {
      if (this.offline) {
        socket.destroy()
        return
      }
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
    server.on('request', (req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (!res.headersSent && !res.destroyed) {
          this.send(res, { status: 500, body: { message: `fake server error: ${String(error)}` } })
        }
      })
    })
  }

  // ───────────────────────── 기록 ─────────────────────────

  /** 받은 요청들(복사본) */
  get requests(): RecordedRequest[] {
    return [...this.recorded]
  }

  /** 받은 요청의 key 목록 */
  requestKeys(): string[] {
    return this.recorded.map((r) => r.key)
  }

  findRequests(match: RequestMatcher): RecordedRequest[] {
    const fn = toMatcher(match)
    return this.recorded.filter(fn)
  }

  hasRequest(match: RequestMatcher): boolean {
    return this.findRequests(match).length > 0
  }

  /** 조건에 맞는 요청이 (이미 왔거나) 올 때까지 기다린다 */
  waitForRequest(match: RequestMatcher, timeoutMs = 10_000): Promise<RecordedRequest> {
    const fn = toMatcher(match)
    const done = this.recorded.find(fn)
    if (done) return Promise.resolve(done)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        reject(new Error(`fake GitHub: no request matched within ${timeoutMs}ms`))
      }, timeoutMs)
      const waiter: Waiter = {
        match: fn,
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      }
      this.waiters.push(waiter)
    })
  }

  clearRequests(): void {
    this.recorded = []
  }

  // ───────────────────────── 조종 ─────────────────────────

  /**
   * 다음 n 개의 쓰기 요청을 실패시킨다. 상태는 바뀌지 않는다. 쓰기 = GET·HEAD 가 아닌 REST(`POST /markdown`
   * 미리보기 제외) + GraphQL mutation(반응·코멘트·닫기·다시 열기). GraphQL 조회는 세지 않는다
   */
  failNextWrites(count = 1, options: Omit<FaultOptions, 'match'> = {}): void {
    this.failNext(count, { ...options, match: isWriteRequest })
  }

  /** 조건에 맞는 다음 n 개 요청을 실패시킨다. 기본: 모든 /api 요청, 500 */
  failNext(count = 1, options: FaultOptions = {}): void {
    this.faults.push({
      remaining: count,
      status: options.status ?? 500,
      match: options.match ? toMatcher(options.match) : (r) => r.area === 'api',
      body: options.body,
      headers: options.headers
    })
  }

  /** 연결을 받지 않는다(기존 연결도 끊는다). 클라이언트는 네트워크 오류를 받는다 */
  goOffline(): void {
    this.offline = true
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
  }

  goOnline(): void {
    this.offline = false
  }

  get isOffline(): boolean {
    return this.offline
  }

  /** 켜면 모든 /api 요청이 401 (토큰 만료·취소) */
  setUnauthorized(on = true): void {
    this.unauthorized = on
  }

  /** GET /user 의 X-OAuth-Scopes 값. null 이면 헤더를 보내지 않는다 */
  setScopes(header: string | null): void {
    this.scopes = header
  }

  /** 세분화 토큰 흉내: X-OAuth-Scopes 없음 + /notifications 403. 끄면 기본 권한으로 돌아간다 */
  setFineGrained(on = true): void {
    this.fineGrained = on
    this.scopes = on ? null : FIXTURE.scopes
  }

  /** 알림 응답의 X-Poll-Interval(초). 기본 60 */
  setPollInterval(seconds: number): void {
    this.pollInterval = seconds
  }

  /** 모든 응답을 이만큼 늦춘다(로딩 상태 테스트용) */
  setDelay(ms: number): void {
    this.delayMs = Math.max(0, ms)
  }

  /** 요청 한도 헤더 값. remaining 을 주면 고정, null 이면 요청마다 줄어든다(기본) */
  setRateLimit(options: { limit?: number; remaining?: number | null }): void {
    if (options.limit !== undefined) this.rateLimit.limit = options.limit
    if (options.remaining !== undefined) this.rateLimit.remaining = options.remaining
  }

  /**
   * 1차 요청 한도 초과를 흉내 낸다. /api 요청이 403 과 `x-ratelimit-remaining: 0`,
   * `x-ratelimit-reset: resetAt`(epoch 초)를 받는다. GET /rate_limit(연결 확인)은 GitHub 처럼 한도와
   * 관계없이 응답한다. null 이면 끈다.
   * 기본 resetAt 은 지금부터 1시간 뒤.
   */
  setRateLimited(resetAt: number | null = Math.floor(Date.now() / 1000) + 3600): void {
    this.rateLimitedUntil = resetAt
  }

  /**
   * 저장소를 지운다(삭제·권한 상실 흉내). 내 저장소·스타 목록에서 빠지고, GET /repositories/{id} 와
   * 상세 GraphQL 은 404(NOT_FOUND)가 된다. 그 저장소의 PR·이슈·알림도 함께 지운다. reset() 으로 되돌린다.
   */
  removeRepo(repoId: number): void {
    this.state.repos = this.state.repos.filter((r) => r.id !== repoId)
    this.state.items = this.state.items.filter((i) => i.repoId !== repoId)
    this.state.notifications = this.state.notifications.filter((n) => n.repoId !== repoId)
  }

  /**
   * GET /user 의 email(프로필 공개 이메일). 기본 FIXTURE.viewer.email, null 이면 공개하지 않음.
   * 앱은 로그인할 때 읽으므로 앱을 띄우기 전에(또는 serverOptions.customize 의 state.viewerEmail 로) 정한다.
   * reset() 은 기본값으로 돌린다.
   */
  setUserEmail(email: string | null): void {
    this.state.viewerEmail = email
  }

  /**
   * 앱에서 POST 로 만든 이슈를 검색(GraphQL search: 내 이슈·할당·언급)에 반영한다. 반영 전에는 저장소 연결
   * 목록(GdeskRepoOpenItems·상세)에는 나오지만 검색에는 나오지 않는다(GitHub 검색 지연 흉내)
   */
  indexCreatedIssues(): void {
    for (const item of this.state.items) {
      if (item.createdInAppAt !== undefined) item.searchIndexed = true
    }
  }

  /** 만든 이슈가 검색에 나오기까지의 지연(ms). null(기본)이면 indexCreatedIssues() 를 부를 때까지 */
  setSearchIndexDelay(ms: number | null): void {
    this.searchIndexDelayMs = ms === null ? null : Math.max(0, ms)
  }

  /** 기기 인증 폴링 결과. 기본 'pending'(사용자가 아직 승인하지 않음) */
  setDeviceFlowOutcome(outcome: DeviceFlowOutcome): void {
    this.deviceOutcome = outcome
  }

  approveDeviceFlow(): void {
    this.deviceOutcome = 'approve'
  }

  /** 데이터·모드·기록을 처음 상태로 돌린다(연결은 유지) */
  reset(): void {
    this.state = this.freshState()
    this.recorded = []
    this.offline = false
    this.unauthorized = false
    this.faults = []
    this.delayMs = 0
    this.scopes = FIXTURE.scopes
    this.fineGrained = false
    this.pollInterval = 60
    this.notificationsChangedAt = this.fixtureNow
    this.deviceOutcome = 'pending'
    this.rateLimit = { limit: DEFAULT_RATE_LIMIT, remaining: null }
    this.rateLimitedUntil = null
    this.searchIndexDelayMs = null
    this.used.clear()
  }

  async close(): Promise<void> {
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w.reject(new Error('fake GitHub: server closed'))
    this.server.closeAllConnections()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    if (this.gitRoot) await rm(this.gitRoot, { recursive: true, force: true, maxRetries: 3 })
  }

  /** 클론 원본 주소(`gitRepos` 로 만든 저장소) */
  gitUrl(fullName: string): string {
    return `${this.webBase}/${fullName}.git`
  }

  // ───────────────────────── 내부 ─────────────────────────

  private freshState(): FixtureState {
    const state = buildFixtures(this.fixtureNow)
    this.options.customize?.(state)
    return state
  }

  private restContext(): RestContext {
    return {
      state: this.state,
      apiBase: this.apiBase,
      webBase: this.webBase,
      scopes: this.scopes,
      fineGrained: this.fineGrained,
      pollInterval: this.pollInterval,
      notificationsChangedAt: this.notificationsChangedAt,
      touchNotifications: () => {
        // Last-Modified 는 초 단위라 같은 초 안의 변경도 구분되게 1초 이상 앞으로 민다
        this.notificationsChangedAt = Math.max(Date.now(), this.notificationsChangedAt + 1000)
      },
      now: () => Date.now()
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin)
    const method = (req.method ?? 'GET').toUpperCase()
    const raw = await readBody(req)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (k !== 'authorization' && v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v
    }
    const auth = req.headers.authorization ?? ''
    const bearer = /^(?:Bearer|token)\s+(.+)$/i.exec(auth)
    const token = bearer?.[1]?.trim() || null

    let area: Area = 'other'
    let path = url.pathname
    if (path === '/api' || path.startsWith('/api/')) {
      area = 'api'
      path = path.slice(4) || '/'
    } else if (path === '/web' || path.startsWith('/web/')) {
      area = 'web'
      path = path.slice(4) || '/'
    }

    const record: RecordedRequest = {
      seq: ++this.seq,
      method,
      area,
      path,
      query: Object.fromEntries(url.searchParams),
      key: area === 'web' ? `WEB ${method} ${path}` : `${method} ${path}`,
      headers,
      token,
      at: Date.now()
    }
    let body: unknown = raw
    if (raw !== '') {
      const type = headers['content-type'] ?? ''
      if (type.includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(raw))
      } else {
        try {
          body = JSON.parse(raw) as unknown
        } catch {
          body = raw
        }
      }
      record.body = body
    }
    const isGraphQL = area === 'api' && path === '/graphql' && method === 'POST'
    if (isGraphQL && isRecord(body)) {
      const op = typeof body.operationName === 'string' ? body.operationName : ''
      record.operationName = op
      record.variables = isRecord(body.variables) ? body.variables : {}
      record.key = `GRAPHQL ${op}`
    }
    this.recorded.push(record)
    for (const w of [...this.waiters]) {
      if (w.match(record)) {
        this.waiters = this.waiters.filter((x) => x !== w)
        w.resolve(record)
      }
    }

    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))

    const response = this.respond(record, body, isGraphQL)
    record.status = response.status
    this.send(res, response)
  }

  private respond(record: RecordedRequest, body: unknown, isGraphQL: boolean): FakeResponse {
    if (record.area === 'web') return this.respondWeb(record)
    if (record.area !== 'api') return { status: 404, body: { message: 'Not Found' } }

    const resource = isGraphQL ? 'graphql' : record.path.startsWith('/search/') ? 'search' : 'core'
    const rate = this.rateHeaders(resource, record.path !== '/rate_limit')
    const withRate = (r: FakeResponse): FakeResponse => ({
      ...r,
      headers: { ...rate, ...r.headers }
    })

    if (this.rateLimitedUntil !== null && record.path !== '/rate_limit') {
      return {
        status: 403,
        body: {
          message: 'API rate limit exceeded for user.',
          documentation_url: 'https://docs.github.com/rest/overview/rate-limits-for-the-rest-api'
        },
        headers: {
          ...rate,
          'x-ratelimit-remaining': '0',
          'x-ratelimit-used': String(this.rateLimit.limit),
          'x-ratelimit-reset': String(this.rateLimitedUntil)
        }
      }
    }

    const fault = this.faults.find((f) => f.remaining > 0 && f.match(record))
    if (fault) {
      fault.remaining--
      this.faults = this.faults.filter((f) => f.remaining > 0)
      return withRate({
        status: fault.status,
        body: fault.body ?? { message: `Fake failure (HTTP ${fault.status})` },
        headers: fault.headers
      })
    }

    const probe = record.path === '/rate_limit' && record.method === 'GET'
    if (this.unauthorized || record.token === FIXTURE.invalidToken) {
      return withRate({ status: 401, body: { message: 'Bad credentials' } })
    }
    if (!record.token && !probe) {
      return withRate({ status: 401, body: { message: 'Requires authentication' } })
    }

    if (probe) return withRate({ status: 200, body: this.rateLimitBody() })

    if (isGraphQL) {
      if (!isRecord(body) || typeof body.query !== 'string') {
        return withRate({ status: 400, body: { message: 'Problems parsing JSON' } })
      }
      const result: GraphQLBody | null = handleGraphQL(
        {
          state: this.state,
          webBase: this.webBase,
          now: () => Date.now(),
          searchIndexDelayMs: this.searchIndexDelayMs
        },
        record.operationName ?? '',
        record.variables ?? {}
      )
      return withRate({
        status: 200,
        body: result ?? {
          errors: [{ message: `Fake GitHub has no handler for '${record.operationName ?? ''}'` }]
        }
      })
    }

    const rest = handleRest(this.restContext(), {
      method: record.method,
      path: record.path,
      query: new URLSearchParams(record.query),
      headers: record.headers,
      body
    })
    return withRate(rest ?? { status: 404, body: { message: 'Not Found' } })
  }

  private respondWeb(record: RecordedRequest): FakeResponse {
    const form = isRecord(record.body) ? record.body : {}
    if (record.method === 'POST' && record.path === '/login/device/code') {
      if (typeof form.client_id !== 'string' || form.client_id === '') {
        return { status: 400, body: { error: 'unauthorized_client' } }
      }
      return {
        status: 200,
        body: {
          device_code: 'fake-device-code',
          user_code: FIXTURE.deviceUserCode,
          verification_uri: `${this.webBase}/login/device`,
          expires_in: 900,
          interval: 1
        }
      }
    }
    if (record.method === 'POST' && record.path === '/login/oauth/access_token') {
      if (form.device_code !== 'fake-device-code') {
        return { status: 200, body: { error: 'incorrect_device_code' } }
      }
      switch (this.deviceOutcome) {
        case 'approve':
          return {
            status: 200,
            body: {
              access_token: FIXTURE.deviceToken,
              token_type: 'bearer',
              scope: 'repo,read:org,notifications'
            }
          }
        case 'deny':
          return { status: 200, body: { error: 'access_denied' } }
        case 'expire':
          return { status: 200, body: { error: 'expired_token' } }
        case 'slow_down':
          // 한 번만 slow_down, 그다음은 대기
          this.deviceOutcome = 'pending'
          return { status: 200, body: { error: 'slow_down', interval: 2 } }
        default:
          return { status: 200, body: { error: 'authorization_pending' } }
      }
    }
    if (record.method === 'GET' && this.gitRoot && /\.git\//.test(record.path)) {
      // git dumb HTTP: info/refs, HEAD, objects/... 를 정적 파일로
      const file = readGitFile(this.gitRoot, record.path)
      return file
        ? { status: 200, body: file, headers: { 'content-type': 'application/octet-stream' } }
        : { status: 404, body: 'Not Found', headers: { 'content-type': 'text/plain' } }
    }
    if (record.method === 'GET') {
      // 브라우저로 연 주소가 실제 GitHub 대신 여기로 온다
      const safe = record.path.replace(/[<>&"]/g, '')
      return {
        status: 200,
        body: `<!doctype html><title>Fake GitHub</title><h1>Fake GitHub</h1><p>${safe}</p>`,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      }
    }
    return { status: 404, body: { message: 'Not Found' } }
  }

  private rateInfo(resource: string) {
    const limit = this.rateLimit.limit
    const used = this.used.get(resource) ?? 0
    const remaining = this.rateLimit.remaining ?? Math.max(0, limit - used)
    const reset = Math.floor(Date.now() / 1000) + 3600
    return { limit, used: limit - remaining, remaining, reset, resource }
  }

  private rateHeaders(resource: string, count: boolean): Record<string, string> {
    if (count) this.used.set(resource, (this.used.get(resource) ?? 0) + 1)
    const info = this.rateInfo(resource)
    return {
      'x-ratelimit-limit': String(info.limit),
      'x-ratelimit-remaining': String(info.remaining),
      'x-ratelimit-used': String(info.used),
      'x-ratelimit-reset': String(info.reset),
      'x-ratelimit-resource': resource
    }
  }

  private rateLimitBody() {
    const core = this.rateInfo('core')
    return {
      resources: { core, graphql: this.rateInfo('graphql'), search: this.rateInfo('search') },
      rate: core
    }
  }

  private send(res: ServerResponse, response: FakeResponse): void {
    if (res.destroyed) return
    const headers: Record<string, string> = { ...response.headers }
    const noBody = response.status === 204 || response.status === 205 || response.status === 304
    let payload: string | Buffer = ''
    if (!noBody && response.body !== undefined) {
      if (Buffer.isBuffer(response.body)) {
        payload = response.body
        headers['content-type'] ??= 'application/octet-stream'
      } else if (typeof response.body === 'string') {
        payload = response.body
        headers['content-type'] ??= 'text/plain; charset=utf-8'
      } else {
        payload = JSON.stringify(response.body)
        headers['content-type'] ??= 'application/json; charset=utf-8'
      }
    }
    if (response.status !== 204 && response.status !== 304) {
      headers['content-length'] = String(Buffer.byteLength(payload))
    }
    res.writeHead(response.status, headers)
    res.end(noBody ? undefined : payload)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 127.0.0.1 의 임의 포트에서 가짜 GitHub 를 띄운다 */
export async function startFakeGitHub(options: StartFakeGitHubOptions = {}): Promise<FakeGitHub> {
  const server = createServer()
  server.keepAliveTimeout = 1000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  let gitRoot: string | null = null
  if (options.gitRepos && options.gitRepos.length > 0) {
    gitRoot = await mkdtemp(join(tmpdir(), 'gdesk-fake-git-'))
    try {
      await createBareRepos(gitRoot, options.gitRepos)
    } catch (error) {
      server.close()
      await rm(gitRoot, { recursive: true, force: true })
      throw error
    }
  }
  return new FakeGitHub(server, port, options, gitRoot)
}
