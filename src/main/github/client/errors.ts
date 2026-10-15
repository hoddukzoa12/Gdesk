import type { OrgRestriction, OrgRestrictionReason } from './org-restriction'
import type { RateLimitKind } from './rate-limit'

/**
 * GitHub 요청 계층의 오류. 어느 오류도 토큰·요청 헤더·원본 Response 를 담지 않는다.
 * 문구는 만들기 전에 redact() 를 거친다.
 */
export class GitHubClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export interface GitHubHttpErrorInit {
  documentationUrl?: string
  method?: string
  /** 쿼리 문자열을 뺀 경로 */
  path?: string
}

/** 2xx 가 아닌 응답 (한도·세션·조직 제한으로 분류되지 않은 것) */
export class GitHubHttpError extends GitHubClientError {
  readonly status: number
  readonly documentationUrl: string | undefined
  readonly method: string | undefined
  readonly path: string | undefined

  constructor(status: number, message: string, init: GitHubHttpErrorInit = {}) {
    super(message)
    this.status = status
    this.documentationUrl = init.documentationUrl
    this.method = init.method
    this.path = init.path
  }
}

/** 요청 한도로 미뤄진 상태. resetAt(ms, epoch) 전까지 같은 자원의 요청은 이 오류로 바로 거절된다. */
export class RateLimitedError extends GitHubClientError {
  readonly resetAt: number
  readonly resource: string
  readonly kind: RateLimitKind
  /** 오류를 만든 시점 기준 남은 대기(ms) */
  readonly waitMs: number

  constructor(init: { resetAt: number; resource: string; kind: RateLimitKind; now: number }) {
    const waitMs = Math.max(0, init.resetAt - init.now)
    super(
      `GitHub ${init.kind} rate limit (${init.resource}); retry after ${new Date(init.resetAt).toISOString()}`
    )
    this.resetAt = init.resetAt
    this.resource = init.resource
    this.kind = init.kind
    this.waitMs = waitMs
  }
}

/** 401 을 받았거나 토큰이 없다. 다시 로그인한 뒤 resetSession() 전까지 요청하지 않는다. */
export class SessionExpiredError extends GitHubClientError {
  constructor(message = 'GitHub session expired; sign in again') {
    super(message)
  }
}

/** 네트워크 실패 (fetch 가 던짐) */
export class OfflineError extends GitHubClientError {
  constructor(detail?: string) {
    super(detail ? `Network request failed: ${detail}` : 'Network request failed')
  }
}

/** 조직이 이 OAuth 앱의 접근을 막았거나(OAuth App access restrictions) SAML 인증을 요구한다. */
export class OrgAccessRestrictedError extends GitHubClientError {
  /** 알아낼 수 있으면 조직 login */
  readonly orgLogin: string | undefined
  readonly reason: OrgRestrictionReason
  /** REST 면 403, GraphQL 이면 HTTP 상태(대개 200) */
  readonly status: number

  constructor(restriction: OrgRestriction, status: number) {
    super(restriction.message)
    this.orgLogin = restriction.orgLogin
    this.reason = restriction.reason
    this.status = status
  }
}

export interface GraphQLErrorItem {
  message: string
  type?: string
  path?: (string | number)[]
  locations?: { line: number; column: number }[]
  extensions?: Record<string, unknown>
}

/** data 없이 errors 만 돌아온 GraphQL 응답 */
export class GraphQLError extends GitHubClientError {
  readonly errors: GraphQLErrorItem[]

  constructor(errors: GraphQLErrorItem[]) {
    const first = errors[0]?.message ?? 'Empty GraphQL response'
    const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
    super(`GraphQL error: ${first}${more}`)
    this.errors = errors
  }
}
