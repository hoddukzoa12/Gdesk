import { describe, expect, it } from 'vitest'
import {
  TokenValidationError,
  computeMissingScopes,
  detectTokenKind,
  isInboxAvailable,
  parseScopes,
  parseUser,
  validateToken
} from './token-validate'
import { createFakeFetch, userResponse } from './test-helpers'

const API = 'https://api.github.example'

describe('parseScopes', () => {
  it('쉼표로 나눈다. 헤더가 없으면 null, 비어 있으면 빈 목록', () => {
    expect(parseScopes('repo, read:org,notifications')).toEqual([
      'repo',
      'read:org',
      'notifications'
    ])
    expect(parseScopes('')).toEqual([])
    expect(parseScopes(null)).toBeNull()
  })
})

describe('detectTokenKind', () => {
  it('github_pat_ 는 세분화 토큰', () => {
    expect(detectTokenKind('github_pat_abc', 'repo')).toBe('fine_grained')
  })
  it('X-OAuth-Scopes 헤더가 없으면 세분화 토큰', () => {
    expect(detectTokenKind('ghp_abc', null)).toBe('fine_grained')
  })
  it('gho_ 는 oauth', () => {
    expect(detectTokenKind('gho_abc', 'repo')).toBe('oauth')
  })
  it('헤더가 있는 ghp_ 는 classic', () => {
    expect(detectTokenKind('ghp_abc', 'repo')).toBe('classic')
    expect(detectTokenKind('ghp_abc', '')).toBe('classic')
  })
})

describe('computeMissingScopes', () => {
  it('모두 있으면 빈 목록', () => {
    expect(computeMissingScopes(['repo', 'read:org', 'notifications'], 'classic')).toEqual([])
  })

  it('빠진 권한과 영향을 데이터로 돌려준다', () => {
    expect(computeMissingScopes([], 'classic')).toEqual([
      { scope: 'repo', impact: 'private_repos_and_star' },
      { scope: 'read:org', impact: 'org_repos_and_team_reviews' },
      { scope: 'notifications', impact: 'inbox' }
    ])
    expect(computeMissingScopes(['repo', 'read:org'], 'classic')).toEqual([])
    expect(computeMissingScopes(['public_repo', 'notifications'], 'classic')).toEqual([
      { scope: 'repo', impact: 'private_repos_and_star' },
      { scope: 'read:org', impact: 'org_repos_and_team_reviews' }
    ])
  })

  it('상위 권한이 하위 권한을 포함한다(admin:org ⊃ read:org, repo ⊃ notifications 읽기)', () => {
    expect(computeMissingScopes(['repo', 'admin:org'], 'oauth')).toEqual([])
    expect(computeMissingScopes(['repo', 'write:org'], 'classic')).toEqual([])
  })

  it('세분화 토큰은 권한 목록으로 판단하지 않는다', () => {
    expect(computeMissingScopes(null, 'fine_grained')).toEqual([])
  })
})

describe('isInboxAvailable', () => {
  it('세분화 토큰은 Inbox 를 쓸 수 없다', () => {
    expect(isInboxAvailable('fine_grained', [])).toBe(false)
  })
  it('notifications 권한이 없으면 쓸 수 없다', () => {
    expect(isInboxAvailable('classic', [{ scope: 'notifications', impact: 'inbox' }])).toBe(false)
    expect(isInboxAvailable('classic', [])).toBe(true)
  })
})

describe('parseUser 의 공개 이메일', () => {
  const base = { id: 7, login: 'octo', name: null, avatar_url: 'a' }
  it('공개 이메일이 있으면 담고, 없거나(null·빈 문자열·필드 없음·다른 형) null', () => {
    expect(parseUser({ ...base, email: 'octo@example.com' })?.email).toBe('octo@example.com')
    expect(parseUser({ ...base, email: null })?.email).toBeNull()
    expect(parseUser({ ...base, email: '' })?.email).toBeNull()
    expect(parseUser({ ...base, email: 3 })?.email).toBeNull()
    expect(parseUser(base)?.email).toBeNull()
  })

  it('로그인 확인(GET /user)도 이메일을 담는다', async () => {
    const fake = createFakeFetch(() =>
      userResponse({ id: 7, login: 'octo', email: 'octo@example.com' }, 'repo')
    )
    const result = await validateToken('ghp_' + 'x'.repeat(36), {
      fetch: fake.fetch,
      apiBase: API
    })
    expect(result.user.email).toBe('octo@example.com')
  })
})

describe('validateToken', () => {
  const TOKEN = 'ghp_ValidateTokenSecret1234567890abcd'

  it('GET /user 로 확인하고 사용자·권한을 돌려준다', async () => {
    const fake = createFakeFetch(() => userResponse({ id: 7, login: 'octo', name: 'Octo' }, 'repo'))
    const result = await validateToken(TOKEN, { fetch: fake.fetch, apiBase: API })
    expect(fake.calls).toHaveLength(1)
    const req = fake.calls[0]!
    expect(req.url.toString()).toBe(`${API}/user`)
    expect(req.method).toBe('GET')
    expect(req.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(result).toEqual({
      user: {
        id: 7,
        login: 'octo',
        name: 'Octo',
        avatarUrl: 'https://avatars.example/u/7',
        email: null
      },
      tokenKind: 'classic',
      scopes: ['repo']
    })
  })

  it('헤더가 없으면 세분화 토큰', async () => {
    const fake = createFakeFetch(() => userResponse({ id: 7, login: 'octo' }, null))
    const result = await validateToken('github_pat_' + 'x'.repeat(30), {
      fetch: fake.fetch,
      apiBase: API
    })
    expect(result.tokenKind).toBe('fine_grained')
    expect(result.scopes).toBeNull()
  })

  it('기기 인증에서 온 토큰은 oauth', async () => {
    const fake = createFakeFetch(() => userResponse({ id: 7, login: 'octo' }, 'repo'))
    const result = await validateToken('opaque', {
      fetch: fake.fetch,
      apiBase: API,
      kindHint: 'oauth'
    })
    expect(result.tokenKind).toBe('oauth')
  })

  it('401 이면 invalid_token', async () => {
    const fake = createFakeFetch(
      () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    )
    await expect(validateToken(TOKEN, { fetch: fake.fetch, apiBase: API })).rejects.toMatchObject({
      code: 'invalid_token'
    })
  })

  it('그 밖의 실패 상태는 http_error', async () => {
    const fake = createFakeFetch(() => new Response('oops', { status: 500 }))
    await expect(validateToken(TOKEN, { fetch: fake.fetch, apiBase: API })).rejects.toMatchObject({
      code: 'http_error'
    })
  })

  it('네트워크 실패는 offline 이고 오류 문구에 토큰이 없다', async () => {
    const fake = createFakeFetch(() => {
      throw new TypeError(`connect failed for Bearer ${TOKEN}`)
    })
    const error = await validateToken(TOKEN, { fetch: fake.fetch, apiBase: API }).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(TokenValidationError)
    expect((error as TokenValidationError).code).toBe('offline')
    expect(String((error as Error).message)).not.toContain(TOKEN)
    expect(JSON.stringify(error)).not.toContain(TOKEN)
    expect((error as Error).stack ?? '').not.toContain(TOKEN)
  })

  it('응답 모양이 이상하면 http_error', async () => {
    const fake = createFakeFetch(
      () => new Response(JSON.stringify({ nope: true }), { status: 200 })
    )
    await expect(validateToken(TOKEN, { fetch: fake.fetch, apiBase: API })).rejects.toMatchObject({
      code: 'http_error'
    })
  })
})
