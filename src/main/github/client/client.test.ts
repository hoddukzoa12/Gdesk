import { describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { Scheduler } from './client'
import { createGitHubClientForTests } from './testing'
import {
  GitHubHttpError,
  GraphQLError,
  OfflineError,
  OrgAccessRestrictedError,
  RateLimitedError,
  SessionExpiredError
} from './errors'

const BASE = 'https://api.test'
const TOKEN = 'gho_SECRETtoken1234567890abcdefXYZ'
const NOW = 1_700_000_000_000
const RESET_S = 1_700_000_600

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })
}

function rl(remaining: number, limit: number, resource: string, reset = RESET_S) {
  return {
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-limit': String(limit),
    'x-ratelimit-reset': String(reset),
    'x-ratelimit-resource': resource
  }
}

/** 시각과 타이머를 손으로 움직이는 가짜 시계 */
function fakeClock() {
  let now = NOW
  let seq = 0
  const tasks = new Map<number, { at: number; fn: () => void }>()
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const id = ++seq
      tasks.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(handle) {
      tasks.delete(handle as number)
    }
  }
  return {
    now: () => now,
    scheduler,
    pending: () => tasks.size,
    advance(ms: number) {
      now += ms
      for (const [id, task] of [...tasks].sort((a, b) => a[1].at - b[1].at)) {
        if (task.at <= now) {
          tasks.delete(id)
          task.fn()
        }
      }
    }
  }
}

function setup(
  handler: Handler,
  opts: { token?: string | null; lowThreshold?: number; timeoutMs?: number } = {}
) {
  const clock = fakeClock()
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    return handler(url, init ?? {})
  })
  const client = createGitHubClientForTests({
    tokenProvider: () => (opts.token === undefined ? TOKEN : opts.token),
    fetch: fetchFn as unknown as typeof fetch,
    baseUrl: BASE,
    now: clock.now,
    scheduler: clock.scheduler,
    lowRateLimitThreshold: opts.lowThreshold,
    requestTimeoutMs: opts.timeoutMs
  })
  const statuses: ConnectionStatus[] = []
  client.onStatusChange((s) => statuses.push(s))
  return { client, clock, calls, fetchFn, statuses }
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name)
}

describe('요청 형식', () => {
  it('REST GET 은 필수 헤더와 토큰을 보내고 JSON 을 읽는다', async () => {
    const { client, calls } = setup(() => json({ login: 'octo' }, 200, rl(4999, 5000, 'core')))
    const res = await client.get<{ login: string }>('/user', {
      query: { per_page: 50, x: undefined }
    })
    expect(res.data).toEqual({ login: 'octo' })
    expect(res.status).toBe(200)
    expect(calls[0]?.url).toBe(`${BASE}/user?per_page=50`)
    const init = calls[0]!.init
    expect(init.method).toBe('GET')
    expect(header(init, 'accept')).toBe('application/vnd.github+json')
    expect(header(init, 'x-github-api-version')).toBe('2022-11-28')
    expect(header(init, 'user-agent')).toBe('Gdesk')
    expect(header(init, 'authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('PUT/PATCH/DELETE 는 본문을 JSON 으로 보내고 204 는 null', async () => {
    const { client, calls } = setup((_url, init) =>
      init.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ ok: true })
    )
    await client.put('/a', { x: 1 })
    await client.patch('/b', { y: 2 })
    const del = await client.delete('/c')
    expect(calls.map((c) => c.init.method)).toEqual(['PUT', 'PATCH', 'DELETE'])
    expect(calls[0]?.init.body).toBe('{"x":1}')
    expect(header(calls[0]!.init, 'content-type')).toBe('application/json')
    expect(calls[1]?.init.body).toBe('{"y":2}')
    expect(del.data).toBeNull()
  })

  it('GraphQL 은 POST /graphql 로 query·variables·operationName 을 보낸다', async () => {
    const { client, calls } = setup(() => json({ data: { viewer: { login: 'octo' } } }))
    const res = await client.graphql<{ viewer: { login: string } }>(
      'query Me { viewer { login } }',
      { a: 1 },
      { operationName: 'Me' }
    )
    expect(res.data.viewer.login).toBe('octo')
    expect(res.errors).toEqual([])
    expect(calls[0]?.url).toBe(`${BASE}/graphql`)
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: 'query Me { viewer { login } }',
      variables: { a: 1 },
      operationName: 'Me'
    })
  })

  it('토큰이 없으면 요청하지 않고 SessionExpiredError', async () => {
    const { client, fetchFn } = setup(() => json({}), { token: null })
    await expect(client.get('/user')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('Link 페이지 나누기', () => {
  it('next 를 따라 모든 페이지를 모은다', async () => {
    const { client, calls } = setup((url) => {
      const page = new URL(url).searchParams.get('page') ?? '1'
      const link =
        page === '1'
          ? `<${BASE}/repos/o/r/issues?per_page=2&page=2>; rel="next", <${BASE}/repos/o/r/issues?per_page=2&page=3>; rel="last"`
          : page === '2'
            ? `<${BASE}/repos/o/r/issues?per_page=2&page=3>; rel="next"`
            : ''
      return json([`p${page}a`, `p${page}b`], 200, link ? { link } : {})
    })
    const first = await client.get('/repos/o/r/issues', { query: { per_page: 2 } })
    expect(first.links.next).toBe(`${BASE}/repos/o/r/issues?per_page=2&page=2`)
    const all = await client.getAllPages<string>('/repos/o/r/issues', { query: { per_page: 2 } })
    expect(all).toEqual(['p1a', 'p1b', 'p2a', 'p2b', 'p3a', 'p3b'])
    expect(calls).toHaveLength(4)
  })

  it('maxPages 로 멈춘다', async () => {
    const { client } = setup(() => json([1], 200, { link: `<${BASE}/x?page=2>; rel="next"` }))
    const pages = []
    for await (const page of client.paginate<number[]>('/x', { maxPages: 3 })) pages.push(page)
    expect(pages).toHaveLength(3)
  })

  it('API 주소 밖의 next 로는 토큰을 보내지 않는다', async () => {
    const { client, calls } = setup(() =>
      json([1], 200, { link: '<https://evil.example/x?page=2>; rel="next"' })
    )
    await expect(client.getAllPages('/x')).rejects.toThrow(/outside/)
    expect(calls).toHaveLength(1)
    await expect(client.get('https://evil.example/steal')).rejects.toThrow(/outside/)
    expect(calls).toHaveLength(1)
  })
})

describe('요청 한도 추적', () => {
  it('core·graphql·search 를 따로 기록한다', async () => {
    const { client } = setup((url) => {
      if (url.endsWith('/graphql')) return json({ data: {} }, 200, rl(4800, 5000, 'graphql'))
      if (url.includes('/search/')) return json({ items: [] }, 200, rl(29, 30, 'search'))
      return json({}, 200, rl(4999, 5000, 'core'))
    })
    await client.get('/user')
    await client.graphql('{ viewer { login } }')
    await client.get('/search/issues', { query: { q: 'is:open' } })
    expect(client.getRateLimit('core')).toMatchObject({ remaining: 4999, limit: 5000 })
    expect(client.getRateLimit('graphql')).toMatchObject({ remaining: 4800, limit: 5000 })
    expect(client.getRateLimit('search')).toMatchObject({
      remaining: 29,
      limit: 30,
      resetAt: RESET_S * 1000
    })
  })

  it('남은 양이 기준 미만이면 low 신호, 기준은 조정 가능', async () => {
    let remaining = 600
    const { client } = setup(() => json({ data: {} }, 200, rl(remaining, 5000, 'graphql')))
    const onLow = vi.fn()
    client.onRateLimitLow(onLow)
    await client.graphql('{ a }')
    expect(client.isRateLimitLow('graphql')).toBe(false)
    remaining = 499
    await client.graphql('{ a }')
    expect(onLow).toHaveBeenCalledTimes(1)
    expect(onLow).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'graphql', remaining: 499, limit: 5000 })
    )
    expect(client.isRateLimitLow('graphql')).toBe(true)
    client.setLowRateLimitThreshold(0.05)
    expect(client.isRateLimitLow('graphql')).toBe(false)
  })
})

describe('한도 초과 시 미루기', () => {
  it('1차 제한(remaining 0, 403)은 reset 까지 미루고 이후 다시 요청한다', async () => {
    let limited = true
    const { client, clock, fetchFn, statuses } = setup(() =>
      limited
        ? json({ message: 'API rate limit exceeded for user ID 1.' }, 403, rl(0, 5000, 'core'))
        : json({ ok: 1 }, 200, rl(4999, 5000, 'core', RESET_S + 3600))
    )
    const err = await client.get('/user').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt).toBe(RESET_S * 1000)
    expect((err as RateLimitedError).kind).toBe('primary')
    expect((err as RateLimitedError).waitMs).toBe(600_000)
    expect(client.getStatus()).toBe('rate_limited')
    expect(client.getRateLimitedUntil()).toBe(RESET_S * 1000)

    // 미루는 동안은 요청하지 않는다
    await expect(client.get('/user')).rejects.toBeInstanceOf(RateLimitedError)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    clock.advance(599_999)
    expect(client.getStatus()).toBe('rate_limited')
    clock.advance(1)
    // 타이머가 회복을 알린다
    expect(statuses).toEqual(['rate_limited', 'online'])
    expect(client.getStatus()).toBe('online')
    limited = false
    await expect(client.get('/user')).resolves.toMatchObject({ data: { ok: 1 } })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('2차 제한(retry-after)은 그 초만큼 미루고 모든 자원을 막는다', async () => {
    const { client, clock } = setup((url) =>
      url.endsWith('/graphql')
        ? json({ message: 'You have exceeded a secondary rate limit.' }, 403, {
            ...rl(4000, 5000, 'graphql'),
            'retry-after': '45'
          })
        : json({})
    )
    const err = await client.graphql('{ a }').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).kind).toBe('secondary')
    expect((err as RateLimitedError).resetAt).toBe(NOW + 45_000)
    await expect(client.get('/user')).rejects.toBeInstanceOf(RateLimitedError)
    clock.advance(45_000)
    expect(client.getStatus()).toBe('online')
    await expect(client.get('/user')).resolves.toBeDefined()
  })

  it('429 + 2차 제한 문구만 있으면 기본 60초', async () => {
    const { client } = setup(() =>
      json({ message: 'You have exceeded a secondary rate limit' }, 429, rl(10, 5000, 'core'))
    )
    const err = (await client.get('/x').catch((e: unknown) => e)) as RateLimitedError
    expect(err).toBeInstanceOf(RateLimitedError)
    expect(err.resetAt).toBe(NOW + 60_000)
  })

  it('search 가 막혀도 core 는 쓸 수 있다', async () => {
    const { client, fetchFn } = setup((url) =>
      url.includes('/search/')
        ? json({ message: 'API rate limit exceeded' }, 403, rl(0, 30, 'search'))
        : json({ ok: true }, 200, rl(4999, 5000, 'core'))
    )
    await expect(client.get('/search/issues')).rejects.toBeInstanceOf(RateLimitedError)
    await expect(client.get('/search/issues')).rejects.toBeInstanceOf(RateLimitedError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await expect(client.get('/user')).resolves.toMatchObject({ data: { ok: true } })
    expect(client.getStatus()).toBe('rate_limited')
  })

  it('GraphQL 200 응답의 RATE_LIMITED 오류도 1차 제한으로 미룬다', async () => {
    const { client } = setup(() =>
      json(
        { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user ID 1.' }] },
        200,
        rl(0, 5000, 'graphql')
      )
    )
    const err = (await client.graphql('{ a }').catch((e: unknown) => e)) as RateLimitedError
    expect(err).toBeInstanceOf(RateLimitedError)
    expect(err.resource).toBe('graphql')
    expect(err.resetAt).toBe(RESET_S * 1000)
    expect(client.getStatus()).toBe('rate_limited')
  })

  it('getStatus 는 타이머가 안 돌아도 시각으로 판단한다', async () => {
    let now = NOW
    const client = createGitHubClientForTests({
      tokenProvider: () => TOKEN,
      baseUrl: BASE,
      fetch: (async () =>
        json({ message: 'x' }, 403, {
          ...rl(1, 5000, 'core'),
          'retry-after': '10'
        })) as unknown as typeof fetch,
      now: () => now,
      // 타이머가 절대 불리지 않는 스케줄러
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined }
    })
    await client.get('/x').catch(() => undefined)
    expect(client.getStatus()).toBe('rate_limited')
    now += 10_000
    expect(client.getStatus()).toBe('online')
  })
})

describe('연결 상태', () => {
  it('fetch 가 던지면 offline, 이후 응답을 받으면 online', async () => {
    let down = true
    const { client, statuses } = setup(() => {
      if (down) throw new TypeError('fetch failed')
      return json({})
    })
    expect(client.getStatus()).toBe('online')
    await expect(client.get('/user')).rejects.toBeInstanceOf(OfflineError)
    expect(client.getStatus()).toBe('offline')
    // offline 이어도 요청은 계속 나간다
    await expect(client.get('/user')).rejects.toBeInstanceOf(OfflineError)
    down = false
    await client.get('/user')
    expect(client.getStatus()).toBe('online')
    expect(statuses).toEqual(['offline', 'online'])
  })

  it('5xx 응답도 연결은 된 것이므로 offline 을 푼다', async () => {
    let down = true
    const { client } = setup(() => {
      if (down) throw new TypeError('fetch failed')
      return json({ message: 'Server Error' }, 502)
    })
    await client.get('/x').catch(() => undefined)
    down = false
    await expect(client.get('/x')).rejects.toBeInstanceOf(GitHubHttpError)
    expect(client.getStatus()).toBe('online')
  })

  it('checkConnectivity 는 /rate_limit 로 확인하고 상태를 돌려준다', async () => {
    let down = true
    const { client, calls } = setup(() => {
      if (down) throw new TypeError('getaddrinfo ENOTFOUND')
      return json({ resources: {} }, 200, rl(5000, 5000, 'core'))
    })
    await expect(client.checkConnectivity()).resolves.toBe('offline')
    down = false
    await expect(client.checkConnectivity()).resolves.toBe('online')
    expect(calls.at(-1)?.url).toBe(`${BASE}/rate_limit`)
  })

  it('401 이면 session_expired, resetSession 전까지 요청하지 않는다', async () => {
    let unauthorized = true
    const { client, fetchFn, statuses } = setup(() =>
      unauthorized ? json({ message: 'Bad credentials' }, 401) : json({ ok: true })
    )
    await expect(client.get('/user')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(client.getStatus()).toBe('session_expired')
    await expect(client.graphql('{ a }')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    // 다른 성공 응답으로는 풀리지 않는다
    unauthorized = false
    await client.checkConnectivity()
    expect(client.getStatus()).toBe('session_expired')
    client.resetSession()
    expect(client.getStatus()).toBe('online')
    await expect(client.get('/user')).resolves.toMatchObject({ data: { ok: true } })
    expect(statuses).toEqual(['session_expired', 'online'])
  })

  it('겹치면 session_expired > offline > rate_limited 순서로 하나만 보인다', async () => {
    let mode: 'limit' | 'down' | '401' = 'limit'
    const { client, clock, statuses } = setup(() => {
      if (mode === 'down') throw new TypeError('fetch failed')
      if (mode === '401') return json({ message: 'Bad credentials' }, 401)
      return json({ message: 'x' }, 403, rl(0, 5000, 'core'))
    })
    await client.get('/x').catch(() => undefined)
    expect(client.getStatus()).toBe('rate_limited')
    mode = 'down'
    await client.checkConnectivity()
    expect(client.getStatus()).toBe('offline')
    mode = '401'
    await client.checkConnectivity()
    expect(client.getStatus()).toBe('session_expired')
    // 401 응답을 받았다는 건 연결은 된다는 뜻 → offline 은 풀렸고 한도 막힘만 남는다
    client.resetSession()
    expect(client.getStatus()).toBe('rate_limited')
    clock.advance(600_000)
    expect(client.getStatus()).toBe('online')
    // 중간에 잠깐 다른 상태로 보이지 않는다
    expect(statuses).toEqual([
      'rate_limited',
      'offline',
      'session_expired',
      'rate_limited',
      'online'
    ])
  })

  it('같은 상태는 다시 알리지 않고 구독 해제가 된다', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed')
    })
    const listener = vi.fn()
    const off = client.onStatusChange(listener)
    await client.get('/a').catch(() => undefined)
    await client.get('/b').catch(() => undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('offline')
    off()
    client.resetSession()
    await client.checkConnectivity()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('호출자가 취소한 요청은 offline 이 아니다', async () => {
    const { client } = setup((_url, init) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return json({})
    })
    const ac = new AbortController()
    ac.abort()
    await expect(client.get('/x', { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(client.getStatus()).toBe('online')
  })
})

describe('알림 조건부 요청', () => {
  it('If-None-Match·If-Modified-Since 를 보내고 304 면 notModified', async () => {
    const { client, calls } = setup((_url, init) => {
      if (header(init, 'if-none-match') === '"abc"') {
        return new Response(null, {
          status: 304,
          headers: { etag: '"abc"', 'x-poll-interval': '120', ...rl(4999, 5000, 'core') }
        })
      }
      return json([{ id: '1' }], 200, {
        etag: '"abc"',
        'last-modified': 'Thu, 01 Oct 2026 00:00:00 GMT',
        'x-poll-interval': '60'
      })
    })
    const first = await client.getConditional<{ id: string }[]>('/notifications')
    expect(first.notModified).toBe(false)
    if (first.notModified) throw new Error('unreachable')
    expect(first.data).toEqual([{ id: '1' }])
    expect(first.etag).toBe('"abc"')
    expect(first.lastModified).toBe('Thu, 01 Oct 2026 00:00:00 GMT')
    expect(first.pollInterval).toBe(60)

    const second = await client.getConditional('/notifications', {
      etag: first.etag,
      lastModified: first.lastModified
    })
    expect(header(calls[1]!.init, 'if-none-match')).toBe('"abc"')
    expect(header(calls[1]!.init, 'if-modified-since')).toBe('Thu, 01 Oct 2026 00:00:00 GMT')
    expect(second).toMatchObject({ notModified: true, status: 304, pollInterval: 120 })
    expect(client.getRateLimit('core')?.remaining).toBe(4999)
  })

  it('X-Poll-Interval 이 없으면 undefined', async () => {
    const { client } = setup(() => json([]))
    const res = await client.getConditional('/notifications')
    expect(res.pollInterval).toBeUndefined()
  })
})

describe('GraphQL 오류', () => {
  it('data 없이 errors 만 오면 GraphQLError', async () => {
    const { client } = setup(() =>
      json({ errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] })
    )
    const err = (await client.graphql('{ a }').catch((e: unknown) => e)) as GraphQLError
    expect(err).toBeInstanceOf(GraphQLError)
    expect(err.errors).toHaveLength(1)
    expect(err.errors[0]?.type).toBe('NOT_FOUND')
    expect(err.message).toContain('Could not resolve to a Repository')
  })

  it('부분 데이터는 data 와 errors 를 함께 돌려준다', async () => {
    const { client } = setup(() =>
      json({
        data: { a: { id: 1 }, b: null },
        errors: [{ type: 'NOT_FOUND', message: 'nope', path: ['b'] }]
      })
    )
    const res = await client.graphql<{ a: { id: number }; b: null }>('{ a b }')
    expect(res.data.a.id).toBe(1)
    expect(res.errors).toEqual([{ type: 'NOT_FOUND', message: 'nope', path: ['b'] }])
    expect(res.orgRestrictions).toEqual([])
  })

  it('HTTP 오류는 GitHubHttpError (status, message, documentationUrl)', async () => {
    const { client } = setup(() =>
      json(
        { message: 'Problems parsing JSON', documentation_url: 'https://docs.github.com/graphql' },
        400
      )
    )
    const err = (await client.graphql('{ a }').catch((e: unknown) => e)) as GitHubHttpError
    expect(err).toBeInstanceOf(GitHubHttpError)
    expect(err.status).toBe(400)
    expect(err.message).toContain('Problems parsing JSON')
    expect(err.documentationUrl).toBe('https://docs.github.com/graphql')
  })
})

describe('조직 접근 제한', () => {
  const OAUTH_MSG =
    'Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.'

  it('REST 403 은 OrgAccessRestrictedError(orgLogin)', async () => {
    const { client } = setup(() =>
      json({ message: OAUTH_MSG, documentation_url: 'https://docs.github.com/x' }, 403)
    )
    const err = (await client
      .get('/orgs/acme/repos')
      .catch((e: unknown) => e)) as OrgAccessRestrictedError
    expect(err).toBeInstanceOf(OrgAccessRestrictedError)
    expect(err.orgLogin).toBe('acme')
    expect(err.reason).toBe('oauth_app_restriction')
    expect(err.status).toBe(403)
    expect(client.getStatus()).toBe('online')
  })

  it('REST 403 SAML + X-GitHub-SSO', async () => {
    const { client } = setup(() =>
      json({ message: 'Resource protected by organization SAML enforcement.' }, 403, {
        'x-github-sso': 'required; url=https://github.com/orgs/big-corp/sso?authorization_request=1'
      })
    )
    const err = (await client
      .get('/orgs/big-corp/repos')
      .catch((e: unknown) => e)) as OrgAccessRestrictedError
    expect(err).toBeInstanceOf(OrgAccessRestrictedError)
    expect(err).toMatchObject({ reason: 'saml_enforcement', orgLogin: 'big-corp' })
  })

  it('GraphQL 부분 데이터의 FORBIDDEN 은 orgRestrictions 로 알려 준다', async () => {
    const { client } = setup(() =>
      json({
        data: { viewer: { repositories: { nodes: [{ name: 'a' }, null] } } },
        errors: [
          { type: 'FORBIDDEN', message: OAUTH_MSG, path: ['viewer', 'repositories', 'nodes', 1] }
        ]
      })
    )
    const res = await client.graphql('{ viewer { repositories { nodes { name } } } }')
    expect(res.orgRestrictions).toEqual([
      expect.objectContaining({ reason: 'oauth_app_restriction', orgLogin: 'acme' })
    ])
  })

  it('GraphQL 데이터 없이 제한 오류만 오면 OrgAccessRestrictedError', async () => {
    const { client } = setup(() =>
      json({ data: null, errors: [{ type: 'FORBIDDEN', message: OAUTH_MSG }] })
    )
    const err = (await client
      .graphql('{ organization(login:"acme") { id } }')
      .catch((e: unknown) => e)) as OrgAccessRestrictedError
    expect(err).toBeInstanceOf(OrgAccessRestrictedError)
    expect(err.orgLogin).toBe('acme')
  })

  it('알 수 없는 403 은 일반 GitHubHttpError', async () => {
    const { client } = setup(() =>
      json({ message: 'Resource not accessible by integration' }, 403, rl(4000, 5000, 'core'))
    )
    const err = await client.get('/repos/o/r/hooks').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitHubHttpError)
    expect(err).not.toBeInstanceOf(OrgAccessRestrictedError)
    expect(err).not.toBeInstanceOf(RateLimitedError)
    expect(client.getStatus()).toBe('online')
  })
})

describe('토큰 노출 방지', () => {
  function expectNoToken(err: unknown) {
    expect(err).toBeInstanceOf(Error)
    const e = err as Error & Record<string, unknown>
    expect(e.message).not.toContain(TOKEN)
    expect(String(e)).not.toContain(TOKEN)
    expect(JSON.stringify(e)).not.toContain(TOKEN)
    expect(String(e.stack)).not.toContain(TOKEN)
    for (const value of Object.values(e)) expect(JSON.stringify(value) ?? '').not.toContain(TOKEN)
  }

  it('응답 메시지에 토큰이 섞여도 오류에는 남지 않는다', async () => {
    const echo = `token ${TOKEN} is not allowed; also ghp_abcdefghijklmnopqrstuvwxyz0123456789`
    for (const status of [400, 401, 403, 404, 422, 500]) {
      const { client } = setup(() =>
        json({ message: echo, documentation_url: `https://docs.github.com/?t=${TOKEN}` }, status)
      )
      const err = await client.get('/x').catch((e: unknown) => e)
      expectNoToken(err)
      expect((err as Error).message).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    }
  })

  it('GraphQL 오류와 네트워크 오류에도 토큰이 없다', async () => {
    const g = setup(() => json({ errors: [{ message: `bad ${TOKEN}` }] }))
    expectNoToken(await g.client.graphql('{ a }').catch((e: unknown) => e))

    const n = setup(() => {
      throw new TypeError(`connect failed Authorization: Bearer ${TOKEN}`)
    })
    const err = await n.client.get('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OfflineError)
    expectNoToken(err)
  })

  it('한도 오류에도 토큰이 없다', async () => {
    const { client } = setup(() =>
      json({ message: `rate limit for ${TOKEN}` }, 403, rl(0, 5000, 'core'))
    )
    expectNoToken(await client.get('/x').catch((e: unknown) => e))
  })
})

describe('dispose', () => {
  it('회복 타이머를 정리한다', async () => {
    const { client, clock } = setup(() => json({ message: 'x' }, 403, rl(0, 5000, 'core')))
    await client.get('/x').catch(() => undefined)
    expect(clock.pending()).toBe(1)
    client.dispose()
    expect(clock.pending()).toBe(0)
  })
})

describe('리뷰 보완', () => {
  const OAUTH_MSG =
    'Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.'

  it('data 없이 조직 제한과 다른 오류가 섞이면 GraphQLError 가 orgRestrictions 를 담는다', async () => {
    const { client } = setup(() =>
      json({
        data: null,
        errors: [
          { type: 'FORBIDDEN', message: OAUTH_MSG, path: ['organization'] },
          { type: 'NOT_FOUND', message: 'Could not resolve to a Repository', path: ['repository'] }
        ]
      })
    )
    const err = (await client.graphql('{ a }').catch((e: unknown) => e)) as GraphQLError
    expect(err).toBeInstanceOf(GraphQLError)
    expect(err).not.toBeInstanceOf(OrgAccessRestrictedError)
    expect(err.errors).toHaveLength(2)
    expect(err.orgRestrictions).toEqual([
      expect.objectContaining({ reason: 'oauth_app_restriction', orgLogin: 'acme' })
    ])
  })

  it('조직 제한이 없는 GraphQLError 의 orgRestrictions 는 빈 배열', async () => {
    const { client } = setup(() => json({ errors: [{ type: 'NOT_FOUND', message: 'nope' }] }))
    const err = (await client.graphql('{ a }').catch((e: unknown) => e)) as GraphQLError
    expect(err.orgRestrictions).toEqual([])
  })

  /** signal 이 끊길 때까지 응답하지 않는 fetch */
  const hang: Handler = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal
      if (!signal) return
      if (signal.aborted) reject(new DOMException('aborted', 'AbortError'))
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })

  it('응답이 기본 30초 안에 오지 않으면 offline', async () => {
    const { client, clock, statuses } = setup(hang)
    const pending = client.get('/x').catch((e: unknown) => e)
    await new Promise((resolve) => setImmediate(resolve))
    clock.advance(29_999)
    expect(client.getStatus()).toBe('online')
    clock.advance(1)
    const err = await pending
    expect(err).toBeInstanceOf(OfflineError)
    expect((err as Error).message).toMatch(/timed out/)
    expect(client.getStatus()).toBe('offline')
    expect(statuses).toEqual(['offline'])
    expect(clock.pending()).toBe(0)
  })

  it('제한 시간은 조정할 수 있고, 응답이 오면 타이머를 정리한다', async () => {
    const t = setup(hang, { timeoutMs: 5_000 })
    const pending = t.client.graphql('{ a }').catch((e: unknown) => e)
    await new Promise((resolve) => setImmediate(resolve))
    t.clock.advance(5_000)
    expect(await pending).toBeInstanceOf(OfflineError)

    const ok = setup(() => json({}), { timeoutMs: 5_000 })
    await ok.client.get('/x')
    expect(ok.clock.pending()).toBe(0)
  })

  it('호출자가 도중에 취소하면 offline 이 아니다', async () => {
    const { client } = setup(hang)
    const ac = new AbortController()
    const pending = client.get('/x', { signal: ac.signal }).catch((e: unknown) => e)
    await new Promise((resolve) => setImmediate(resolve))
    ac.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
    expect(client.getStatus()).toBe('online')
  })

  it('토큰 없이 연결 확인하면 인증된 한도 기록을 덮어쓰지 않는다', async () => {
    let token: string | null = TOKEN
    const clock = fakeClock()
    const client = createGitHubClientForTests({
      tokenProvider: () => token,
      baseUrl: BASE,
      now: clock.now,
      scheduler: clock.scheduler,
      fetch: (async (_input: unknown, init?: RequestInit) =>
        new Headers(init?.headers).has('authorization')
          ? json({}, 200, rl(4000, 5000, 'core'))
          : json({}, 200, rl(59, 60, 'core'))) as unknown as typeof fetch
    })
    await client.get('/user')
    expect(client.getRateLimit('core')).toMatchObject({ remaining: 4000, limit: 5000 })
    token = null
    await expect(client.checkConnectivity()).resolves.toBe('online')
    expect(client.getRateLimit('core')).toMatchObject({ remaining: 4000, limit: 5000 })
    expect(client.isRateLimitLow('core')).toBe(false)
  })
})
