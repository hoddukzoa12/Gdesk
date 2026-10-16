import type {
  MissingScope,
  RequiredScope,
  ScopeImpact,
  SessionUser,
  TokenKind
} from '@shared/domain/session'
import { GITHUB_ACCEPT, GITHUB_API_VERSION, USER_AGENT } from '../github/client'

/**
 * 토큰 확인(GET /user)과 권한 계산. 아직 저장하지 않은 후보 토큰을 확인하므로
 * 공용 GitHub 클라이언트(저장된 토큰을 씀)가 아니라 주입한 fetch 로 직접 묻는다.
 * 어떤 오류 문구에도 토큰·응답 원문을 싣지 않는다.
 */

export type TokenValidationErrorCode = 'invalid_token' | 'offline' | 'http_error'

export class TokenValidationError extends Error {
  readonly code: TokenValidationErrorCode
  readonly status: number | undefined
  constructor(code: TokenValidationErrorCode, status?: number) {
    super(
      status === undefined
        ? `Token check failed (${code})`
        : `Token check failed (${code}, HTTP ${status})`
    )
    this.name = 'TokenValidationError'
    this.code = code
    this.status = status
  }
}

export interface ValidatedToken {
  user: SessionUser
  tokenKind: TokenKind
  /** X-OAuth-Scopes. 헤더가 없으면(세분화 토큰) null */
  scopes: string[] | null
}

export interface ValidateTokenOptions {
  fetch: typeof fetch
  /** GitHub API 주소 (githubApiBase()) */
  apiBase: string
  /** 기기 인증에서 받은 토큰이면 'oauth' */
  kindHint?: 'oauth'
  timeoutMs?: number
}

const SCOPE_RULES: readonly { scope: RequiredScope; satisfiedBy: string[]; impact: ScopeImpact }[] =
  [
    { scope: 'repo', satisfiedBy: ['repo'], impact: 'private_repos_and_star' },
    {
      scope: 'read:org',
      satisfiedBy: ['read:org', 'write:org', 'admin:org'],
      impact: 'org_repos_and_team_reviews'
    },
    // 알림 API 는 notifications 또는 repo 권한으로 읽을 수 있다
    { scope: 'notifications', satisfiedBy: ['notifications', 'repo'], impact: 'inbox' }
  ]

export function parseScopes(header: string | null): string[] | null {
  if (header === null) return null
  return header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function detectTokenKind(
  token: string,
  scopesHeader: string | null,
  kindHint?: 'oauth'
): TokenKind {
  if (token.startsWith('github_pat_')) return 'fine_grained'
  if (kindHint === 'oauth' || token.startsWith('gho_')) return 'oauth'
  if (scopesHeader === null) return 'fine_grained'
  return 'classic'
}

/** 필요한 권한 중 빠진 것과 그 영향. 세분화 토큰은 권한 목록이 없으므로 빈 목록. */
export function computeMissingScopes(scopes: string[] | null, kind: TokenKind): MissingScope[] {
  if (kind === 'fine_grained' || scopes === null) return []
  const have = new Set(scopes)
  return SCOPE_RULES.filter((rule) => !rule.satisfiedBy.some((s) => have.has(s))).map(
    ({ scope, impact }) => ({ scope, impact })
  )
}

/** 세분화 토큰은 알림 API 를 쓸 수 없다. classic·oauth 는 notifications(또는 repo) 권한이 있어야 한다. */
export function isInboxAvailable(kind: TokenKind, missing: MissingScope[]): boolean {
  if (kind === 'fine_grained') return false
  return !missing.some((m) => m.scope === 'notifications')
}

/**
 * GET /user 응답을 사용자 정보로 바꾼다. 모양이 다르면 null.
 * email 은 프로필의 공개 이메일이다(공개하지 않았으면 GitHub 가 null 을 준다). email 권한은 요청하지 않는다.
 */
export function parseUser(body: unknown): SessionUser | null {
  if (typeof body !== 'object' || body === null) return null
  const { id, login, name, avatar_url, email } = body as Record<string, unknown>
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
  if (typeof login !== 'string' || login === '') return null
  return {
    id,
    login,
    name: typeof name === 'string' && name !== '' ? name : null,
    avatarUrl: typeof avatar_url === 'string' ? avatar_url : '',
    email: typeof email === 'string' && email !== '' ? email : null
  }
}

export async function validateToken(
  token: string,
  options: ValidateTokenOptions
): Promise<ValidatedToken> {
  let res: Response
  try {
    res = await options.fetch(`${options.apiBase}/user`, {
      method: 'GET',
      headers: {
        Accept: GITHUB_ACCEPT,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
    })
  } catch {
    // 원래 오류에는 요청 정보(토큰)가 섞일 수 있어 버린다
    throw new TokenValidationError('offline')
  }
  if (res.status === 401) {
    await res.body?.cancel().catch(() => undefined)
    throw new TokenValidationError('invalid_token', 401)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new TokenValidationError('http_error', res.status)
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new TokenValidationError('http_error', res.status)
  }
  const user = parseUser(body)
  if (!user) throw new TokenValidationError('http_error', res.status)

  const header = res.headers.get('x-oauth-scopes')
  return {
    user,
    tokenKind: detectTokenKind(token, header, options.kindHint),
    scopes: parseScopes(header)
  }
}
