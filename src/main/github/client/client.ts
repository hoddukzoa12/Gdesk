import type { ConnectionStatus } from '@shared/domain/connection'
import { resolveConnectionStatus } from '@shared/domain/connection'
import { githubApiBase } from '../../config'
import {
  GitHubClientError,
  GitHubHttpError,
  GraphQLError,
  OfflineError,
  OrgAccessRestrictedError,
  RateLimitedError,
  SessionExpiredError
} from './errors'
import type { GraphQLErrorItem } from './errors'
import { parseLinkHeader } from './link'
import type { LinkRelations } from './link'
import { detectOrgRestriction } from './org-restriction'
import type { OrgRestriction } from './org-restriction'
import {
  RateLimitTracker,
  classifyRateLimit,
  parseRateLimitHeaders,
  resetFrom,
  resourceForRequest
} from './rate-limit'
import type { RateLimitInfo } from './rate-limit'
import { redact } from './redact'

/**
 * GitHub 요청 계층 (메인 프로세스 전용).
 * - GraphQL·REST 요청, 요청 한도 추적, 오프라인 감지.
 * - 연결 상태(online/offline/rate_limited/session_expired)의 유일한 출처.
 * 토큰은 주입된 함수에서 매 요청마다 받고, 어디에도 기록하지 않는다.
 */

export const GITHUB_API_VERSION = '2022-11-28'
export const GITHUB_ACCEPT = 'application/vnd.github+json'
export const USER_AGENT = 'Gdesk'

export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>

/** 시계 주입용. 기본은 전역 setTimeout (unref). */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface GitHubClientOptions {
  tokenProvider: TokenProvider
  /** 테스트용 가짜 fetch. 기본은 전역 fetch. */
  fetch?: typeof fetch
  /** 단위 테스트 전용. 배포 경로는 githubApiBase() 를 쓴다(configureGitHubClient 는 이 값을 받지 않는다). */
  baseUrl?: string
  now?: () => number
  scheduler?: Scheduler
  /** low 신호 기준(한도 대비 비율). 기본 0.1 */
  lowRateLimitThreshold?: number
}

export type QueryValue = string | number | boolean | null | undefined

export interface RestRequestOptions {
  query?: Record<string, QueryValue>
  /** 추가 헤더 (예: Accept 바꾸기). Authorization 은 덮어쓸 수 없다. */
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface ConditionalRequestOptions extends RestRequestOptions {
  /** 지난 응답의 ETag → If-None-Match */
  etag?: string | null
  /** 지난 응답의 Last-Modified → If-Modified-Since */
  lastModified?: string | null
}

export interface PaginateOptions extends RestRequestOptions {
  /** 최대 페이지 수. 기본 무제한 */
  maxPages?: number
}

export interface RestResponseMeta {
  status: number
  headers: Headers
  etag?: string
  lastModified?: string
  /** `X-Poll-Interval` (초). 알림 폴링의 최소 간격 */
  pollInterval?: number
  links: LinkRelations
}

export interface RestResponse<T> extends RestResponseMeta {
  notModified: false
  /** JSON 이면 파싱한 값, 빈 본문이면 null, JSON 이 아니면 문자열 */
  data: T
}

export interface RestNotModified extends RestResponseMeta {
  notModified: true
  status: 304
}

export type RestResult<T> = RestResponse<T> | RestNotModified

export interface GraphQLRequestOptions {
  operationName?: string
  signal?: AbortSignal
}

export interface GraphQLResult<T> {
  data: T
  /** 부분 데이터와 함께 온 오류들 (없으면 빈 배열) */
  errors: GraphQLErrorItem[]
  /** errors 중 조직 접근 제한으로 알아본 것 */
  orgRestrictions: OrgRestriction[]
}

const MAX_TIMER_MS = 2_147_483_647

const defaultScheduler: Scheduler = {
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

interface SendOptions {
  method: string
  url: URL
  resource: string
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 연결 확인용: 세션·한도 막힘을 무시하고 토큰이 없어도 보낸다 */
  probe?: boolean
}

interface Sent {
  res: Response
  token: string | null
  resource: string
}

export class GitHubClient {
  readonly baseUrl: string
  private readonly tokenProvider: TokenProvider
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly scheduler: Scheduler
  private readonly rateLimits: RateLimitTracker

  private offline = false
  private sessionExpired = false
  private status: ConnectionStatus = 'online'
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>()
  private recoveryTimer: { handle: unknown; at: number } | null = null
  private disposed = false

  constructor(options: GitHubClientOptions) {
    this.baseUrl = (options.baseUrl ?? githubApiBase()).replace(/\/+$/, '')
    this.tokenProvider = options.tokenProvider
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.now = options.now ?? Date.now
    this.scheduler = options.scheduler ?? defaultScheduler
    this.rateLimits = new RateLimitTracker({
      now: this.now,
      lowThreshold: options.lowRateLimitThreshold
    })
  }

  // ───────────────────────── GraphQL ─────────────────────────

  async graphql<TData = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    options: GraphQLRequestOptions = {}
  ): Promise<GraphQLResult<TData>> {
    const { res, token, resource } = await this.send({
      method: 'POST',
      url: new URL(`${this.baseUrl}/graphql`),
      resource: 'graphql',
      body: JSON.stringify({ query, variables, operationName: options.operationName }),
      signal: options.signal
    })
    const body = await readBody(res)
    if (!res.ok) this.failFromResponse(res, body, token, resource, 'POST')

    if (!isRecord(body)) {
      this.refreshStatus()
      throw new GraphQLError([{ message: 'Invalid GraphQL response' }])
    }
    const errors = normalizeGraphQLErrors(body.errors, token)

    if (errors.some((e) => e.type === 'RATE_LIMITED')) {
      const now = this.now()
      const hit = {
        kind: 'primary' as const,
        resource: res.headers.get('x-ratelimit-resource')?.trim() || resource,
        resetAt: resetFrom(res.headers, now)
      }
      this.rateLimits.block(hit)
      this.refreshStatus()
      throw new RateLimitedError({ ...hit, now })
    }
    this.refreshStatus()

    const orgRestrictions = errors
      .map((e) => detectOrgRestriction({ message: e.message, type: e.type ?? 'FORBIDDEN' }))
      .filter((r): r is OrgRestriction => r !== null)

    const data = body.data
    if (data === null || data === undefined) {
      const first = orgRestrictions[0]
      if (first && orgRestrictions.length === errors.length) {
        throw new OrgAccessRestrictedError(first, res.status)
      }
      throw new GraphQLError(errors.length > 0 ? errors : [{ message: 'Empty GraphQL response' }])
    }
    return { data: data as TData, errors, orgRestrictions }
  }

  // ───────────────────────── REST ─────────────────────────

  async get<T = unknown>(path: string, options: RestRequestOptions = {}): Promise<RestResponse<T>> {
    return this.restOk<T>('GET', path, undefined, options)
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    options: RestRequestOptions = {}
  ): Promise<RestResponse<T>> {
    return this.restOk<T>('PUT', path, body, options)
  }

  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options: RestRequestOptions = {}
  ): Promise<RestResponse<T>> {
    return this.restOk<T>('PATCH', path, body, options)
  }

  async delete<T = null>(
    path: string,
    options: RestRequestOptions & { body?: unknown } = {}
  ): Promise<RestResponse<T>> {
    return this.restOk<T>('DELETE', path, options.body, options)
  }

  /** 조건부 GET (알림 폴링). 304 면 `{ notModified: true }` */
  async getConditional<T = unknown>(
    path: string,
    options: ConditionalRequestOptions = {}
  ): Promise<RestResult<T>> {
    const headers: Record<string, string> = { ...options.headers }
    if (options.etag) headers['If-None-Match'] = options.etag
    if (options.lastModified) headers['If-Modified-Since'] = options.lastModified
    return this.rest<T>('GET', path, undefined, { ...options, headers }, true)
  }

  /** `Link: rel="next"` 를 따라 페이지별 응답을 차례로 낸다. API 주소 밖으로는 따라가지 않는다. */
  async *paginate<T = unknown>(
    path: string,
    options: PaginateOptions = {}
  ): AsyncGenerator<RestResponse<T>, void, undefined> {
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY
    let next: string | undefined = path
    let query: Record<string, QueryValue> | undefined = options.query
    for (let page = 0; next && page < maxPages; page++) {
      const res: RestResponse<T> = await this.restOk<T>('GET', next, undefined, {
        ...options,
        query
      })
      yield res
      next = res.links.next
      query = undefined // next 주소에 이미 쿼리가 들어 있다
    }
  }

  /** 배열을 돌려주는 목록 API 의 모든 페이지를 모은다. */
  async getAllPages<T = unknown>(path: string, options: PaginateOptions = {}): Promise<T[]> {
    const out: T[] = []
    for await (const page of this.paginate<unknown>(path, options)) {
      if (!Array.isArray(page.data)) {
        throw new GitHubClientError('Expected an array response while paginating')
      }
      out.push(...(page.data as T[]))
    }
    return out
  }

  // ───────────────────────── 연결 상태 ─────────────────────────

  getStatus(): ConnectionStatus {
    return this.refreshStatus()
  }

  /** 상태가 바뀔 때마다 알린다. 돌려준 함수로 구독을 끊는다. */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /**
   * 가벼운 요청(`GET /rate_limit`, 한도를 쓰지 않음)으로 연결을 확인하고 현재 상태를 돌려준다.
   * 세션·한도 막힘과 상관없이 보낸다. 401 이면 session_expired 가 된다.
   */
  async checkConnectivity(): Promise<ConnectionStatus> {
    try {
      const { res } = await this.send({
        method: 'GET',
        url: new URL(`${this.baseUrl}/rate_limit`),
        resource: 'core',
        probe: true
      })
      await res.body?.cancel().catch(() => undefined)
      if (res.status === 401) this.markSessionExpired()
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error
    }
    return this.getStatus()
  }

  /** 다시 로그인한 뒤 인증 계층이 부른다. session_expired 를 푸는 유일한 방법. */
  resetSession(): void {
    this.sessionExpired = false
    this.refreshStatus()
  }

  /** 한도 막힘이 모두 풀리는 시각(ms). 막힘이 없으면 null */
  getRateLimitedUntil(): number | null {
    return this.rateLimits.blockedUntil()
  }

  // ───────────────────────── 요청 한도 ─────────────────────────

  getRateLimit(resource: string): RateLimitInfo | undefined {
    return this.rateLimits.get(resource)
  }

  getRateLimits(): Record<string, RateLimitInfo> {
    return this.rateLimits.snapshot()
  }

  /** 남은 양이 기준 미만인가 (상세 추적 갱신을 미룰지 판단용) */
  isRateLimitLow(resource: string): boolean {
    return this.rateLimits.isLow(resource)
  }

  /** 자원의 남은 양이 기준 미만으로 떨어지는 순간 한 번 알린다. */
  onRateLimitLow(listener: (info: RateLimitInfo) => void): () => void {
    return this.rateLimits.onLow(listener)
  }

  setLowRateLimitThreshold(ratio: number): void {
    this.rateLimits.setLowThreshold(ratio)
  }

  /** 타이머와 구독을 정리한다. */
  dispose(): void {
    this.disposed = true
    this.clearRecoveryTimer()
    this.statusListeners.clear()
  }

  // ───────────────────────── 내부 ─────────────────────────

  private async restOk<T>(
    method: string,
    path: string,
    body: unknown,
    options: RestRequestOptions
  ): Promise<RestResponse<T>> {
    const result = await this.rest<T>(method, path, body, options, false)
    if (result.notModified) {
      throw new GitHubHttpError(304, 'Not Modified', { method, path: pathOnly(path) })
    }
    return result
  }

  private async rest<T>(
    method: string,
    path: string,
    body: unknown,
    options: RestRequestOptions,
    allowNotModified: boolean
  ): Promise<RestResult<T>> {
    const url = this.resolveUrl(path, options.query)
    const { res, token, resource } = await this.send({
      method,
      url,
      resource: resourceForRequest(url.pathname),
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: options.headers,
      signal: options.signal
    })
    const meta = responseMeta(res)
    if (res.status === 304 && allowNotModified) {
      this.refreshStatus()
      await res.body?.cancel().catch(() => undefined)
      return { ...meta, notModified: true, status: 304 }
    }
    const data = await readBody(res)
    if (!res.ok) this.failFromResponse(res, data, token, resource, method, url.pathname)
    this.refreshStatus()
    return { ...meta, notModified: false, data: data as T }
  }

  private resolveUrl(path: string, query?: Record<string, QueryValue>): URL {
    let url: URL
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      // Link 헤더 등 절대 주소: 토큰이 다른 곳으로 가지 않도록 API 주소 안쪽만 허용
      url = new URL(path)
      const base = new URL(this.baseUrl)
      const basePath = base.pathname.replace(/\/+$/, '')
      if (url.origin !== base.origin || !(url.pathname + '/').startsWith(basePath + '/')) {
        throw new GitHubClientError(
          `Refusing to send a request outside the API base (${url.origin})`
        )
      }
    } else {
      url = new URL(`${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`)
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    return url
  }

  private async send(options: SendOptions): Promise<Sent> {
    const { resource } = options
    if (!options.probe) {
      if (this.sessionExpired) throw new SessionExpiredError()
      const block = this.rateLimits.activeBlockFor(resource)
      if (block) {
        this.refreshStatus()
        throw new RateLimitedError({ ...block, now: this.now() })
      }
    }

    const token = (await this.tokenProvider()) || null
    if (!token && !options.probe) throw new SessionExpiredError('Not signed in to GitHub')

    const headers = new Headers(options.headers)
    if (!headers.has('Accept')) headers.set('Accept', GITHUB_ACCEPT)
    headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION)
    headers.set('User-Agent', USER_AGENT)
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    headers.delete('Authorization')
    if (token) headers.set('Authorization', `Bearer ${token}`)

    let res: Response
    try {
      res = await this.fetchFn(options.url, {
        method: options.method,
        headers,
        body: options.body,
        signal: options.signal
      })
    } catch (error) {
      // 호출자가 취소한 것은 네트워크 실패가 아니다
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }
      this.offline = true
      this.refreshStatus()
      throw new OfflineError(redact(describeNetworkError(error), token))
    }

    // 어떤 응답이든 받았으면 연결은 살아 있다
    this.offline = false
    const info = parseRateLimitHeaders(res.headers, resource)
    if (info) this.rateLimits.record(info)
    // 상태 알림은 응답을 분류한 뒤에 한 번만 한다 (401·한도 응답에서 잠깐 online 으로 보이지 않게)
    return { res, token, resource: info?.resource ?? resource }
  }

  private failFromResponse(
    res: Response,
    body: unknown,
    token: string | null,
    resource: string,
    method: string,
    path?: string
  ): never {
    if (res.status === 401) {
      this.markSessionExpired()
      throw new SessionExpiredError()
    }

    const rawMessage =
      isRecord(body) && typeof body.message === 'string'
        ? body.message
        : typeof body === 'string' && body.trim()
          ? body.slice(0, 500)
          : res.statusText || `HTTP ${res.status}`
    const message = redact(rawMessage, token)

    const now = this.now()
    const hit = classifyRateLimit({
      status: res.status,
      headers: res.headers,
      message,
      resource,
      now
    })
    if (hit) {
      this.rateLimits.block(hit)
      this.refreshStatus()
      throw new RateLimitedError({ ...hit, now })
    }
    this.refreshStatus()

    if (res.status === 403) {
      const restriction = detectOrgRestriction({
        message,
        ssoHeader: res.headers.get('x-github-sso')
      })
      if (restriction) throw new OrgAccessRestrictedError(restriction, res.status)
    }

    const documentationUrl =
      isRecord(body) && typeof body.documentation_url === 'string'
        ? redact(body.documentation_url, token)
        : undefined
    throw new GitHubHttpError(res.status, message, { documentationUrl, method, path })
  }

  private markSessionExpired(): void {
    this.sessionExpired = true
    this.refreshStatus()
  }

  /** 조건들로 상태를 다시 계산하고, 바뀌었으면 알린다. 한도 막힘은 시각으로 판단한다. */
  private refreshStatus(): ConnectionStatus {
    const next = resolveConnectionStatus({
      sessionExpired: this.sessionExpired,
      offline: this.offline,
      rateLimited: this.rateLimits.hasActiveBlock()
    })
    if (next !== this.status) {
      this.status = next
      for (const listener of [...this.statusListeners]) {
        try {
          listener(next)
        } catch {
          // 구독자 오류는 무시한다
        }
      }
    }
    this.scheduleRecovery()
    return next
  }

  /** 가장 먼저 풀리는 한도 막힘 시각에 상태를 다시 계산해 회복을 알린다. */
  private scheduleRecovery(): void {
    if (this.disposed) return
    const at = this.rateLimits.nextExpiry()
    if (this.recoveryTimer?.at === at) return
    this.clearRecoveryTimer()
    if (at === null) return
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, at - this.now()))
    const handle = this.scheduler.setTimeout(() => {
      this.recoveryTimer = null
      this.refreshStatus()
    }, delay)
    this.recoveryTimer = { handle, at }
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) {
      this.scheduler.clearTimeout(this.recoveryTimer.handle)
      this.recoveryTimer = null
    }
  }
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new GitHubClient(options)
}

// ───────────────────────── 도우미 ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathOnly(path: string): string {
  return path.split('?')[0] ?? path
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function responseMeta(res: Response): RestResponseMeta {
  const meta: RestResponseMeta = {
    status: res.status,
    headers: res.headers,
    links: parseLinkHeader(res.headers.get('link'))
  }
  const etag = res.headers.get('etag')
  if (etag) meta.etag = etag
  const lastModified = res.headers.get('last-modified')
  if (lastModified) meta.lastModified = lastModified
  const poll = Number(res.headers.get('x-poll-interval') ?? NaN)
  if (Number.isFinite(poll) && poll > 0) meta.pollInterval = poll
  return meta
}

function normalizeGraphQLErrors(raw: unknown, token: string | null): GraphQLErrorItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item: unknown): GraphQLErrorItem => {
    if (!isRecord(item)) return { message: 'Unknown GraphQL error' }
    const out: GraphQLErrorItem = {
      message: redact(
        typeof item.message === 'string' ? item.message : 'Unknown GraphQL error',
        token
      )
    }
    if (typeof item.type === 'string') out.type = item.type
    if (Array.isArray(item.path)) out.path = item.path as (string | number)[]
    if (Array.isArray(item.locations))
      out.locations = item.locations as GraphQLErrorItem['locations']
    if (isRecord(item.extensions)) out.extensions = item.extensions
    return out
  })
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  const cause = (error as { cause?: unknown }).cause
  const code =
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === 'string'
      ? ` (${(cause as { code: string }).code})`
      : ''
  return `${error.message}${code}`
}
