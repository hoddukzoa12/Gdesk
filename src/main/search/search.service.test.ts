import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'
import { openDatabase } from '../db/connection'
import { replaceRepoPullRequests } from '../cache/pull-requests'
import { upsertRepositories } from '../cache/repositories'
import { prRecord, repoRecord } from '../cache/test-fixtures'
import {
  GitHubHttpError,
  OfflineError,
  RateLimitedError,
  SessionExpiredError
} from '../github/client'
import { createSearchService, mapSearchRepository } from './search.service'
import type { SearchClient } from './search.service'

const TOKEN = 'ghp_secret_token_value'

function rawRepo(id: number, fullName: string, patch: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split('/')
  return {
    id,
    name,
    full_name: fullName,
    owner: { login: owner, avatar_url: `https://avatars.example/${owner}` },
    description: `About ${name}`,
    html_url: `https://github.com/${fullName}`,
    private: false,
    fork: false,
    archived: false,
    stargazers_count: 42,
    language: 'TypeScript',
    pushed_at: '2026-10-01T00:00:00Z',
    ...patch
  }
}

function fakeClient(
  options: {
    status?: ConnectionStatus
    get?: (path: string, opts: unknown) => Promise<unknown>
  } = {}
) {
  const get = vi.fn(
    options.get ??
      (async () => ({
        data: { total_count: 1, incomplete_results: false, items: [rawRepo(7, 'acme/widget')] }
      }))
  )
  const client = {
    getStatus: () => options.status ?? 'online',
    get: get as unknown as SearchClient['get']
  } satisfies SearchClient
  return { client, get }
}

describe('search:github', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it.each(['', ' ', 'a', ' b  ', undefined, 42])(
    '검색어가 2자 미만(%j)이면 요청하지 않고 빈 결과',
    async (text) => {
      const { client, get } = fakeClient()
      const service = createSearchService({ db: () => db, client: () => client })
      await expect(service.github(text)).resolves.toEqual({ status: 'ok', items: [] })
      expect(get).not.toHaveBeenCalled()
    }
  )

  it('online 이면 GET /search/repositories 를 q·per_page=10 으로 부르고 결과를 바꾼다', async () => {
    const { client, get } = fakeClient()
    const service = createSearchService({ db: () => db, client: () => client })
    const result = await service.github('  widget  ')
    expect(get).toHaveBeenCalledWith('/search/repositories', {
      query: { q: 'widget', per_page: 10 },
      signal: undefined
    })
    expect(result).toEqual({
      status: 'ok',
      items: [
        {
          id: 7,
          owner: 'acme',
          ownerAvatarUrl: 'https://avatars.example/acme',
          name: 'widget',
          fullName: 'acme/widget',
          description: 'About widget',
          url: 'https://github.com/acme/widget',
          private: false,
          fork: false,
          archived: false,
          stargazerCount: 42,
          primaryLanguage: 'TypeScript',
          pushedAt: '2026-10-01T00:00:00Z'
        }
      ]
    })
  })

  it('최대 10개만 돌려주고 ID·이름이 없는 줄은 버린다', async () => {
    const items = [
      null,
      { full_name: 'no/id' },
      rawRepo(0, 'zero/id'),
      ...Array.from({ length: 12 }, (_, i) => rawRepo(i + 1, `o/r${i + 1}`))
    ]
    const { client } = fakeClient({ get: async () => ({ data: { items } }) })
    const service = createSearchService({ db: () => db, client: () => client })
    const result = await service.github('r1')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.items.map((h) => h.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it.each([
    ['offline', 'offline'],
    ['rate_limited', 'rate_limited'],
    ['session_expired', 'error']
  ] as const)('연결 상태가 %s 이면 요청하지 않고 %s 로 거절한다', async (status, expected) => {
    const { client, get } = fakeClient({ status })
    const service = createSearchService({ db: () => db, client: () => client })
    await expect(service.github('widget')).resolves.toEqual({ status: expected })
    expect(get).not.toHaveBeenCalled()
  })

  it.each([
    ['네트워크 실패', new OfflineError('socket hang up'), 'offline'],
    [
      '검색 한도',
      new RateLimitedError({ resetAt: 2_000, resource: 'search', kind: 'primary', now: 1_000 }),
      'rate_limited'
    ],
    ['세션 만료', new SessionExpiredError(), 'error'],
    ['HTTP 422', new GitHubHttpError(422, `Validation Failed ${TOKEN}`), 'error'],
    ['알 수 없는 오류', new Error(`boom Bearer ${TOKEN}`), 'error']
  ] as const)('%s 이면 %s (오류 문구·토큰은 담지 않는다)', async (_label, error, expected) => {
    const { client } = fakeClient({
      get: async () => {
        throw error
      }
    })
    const service = createSearchService({ db: () => db, client: () => client })
    const result = await service.github('widget')
    expect(result).toEqual({ status: expected })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('응답에 items 가 없으면 빈 결과', async () => {
    const { client } = fakeClient({ get: async () => ({ data: null }) })
    const service = createSearchService({ db: () => db, client: () => client })
    await expect(service.github('widget')).resolves.toEqual({ status: 'ok', items: [] })
  })
})

describe('search:local', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    upsertRepositories(db, [
      repoRecord(1, { owner: 'me', name: 'gdesk-demo', description: 'Demo app' }),
      repoRecord(2, { owner: 'me', name: 'dotfiles' })
    ])
    replaceRepoPullRequests(db, 1, [
      prRecord('p42', 1, { number: 42, title: 'Fix parser', repoFullName: 'me/gdesk-demo' })
    ])
  })
  afterEach(() => db.close())

  it('저장된 정보에서 찾고, 오프라인이어도 클라이언트를 쓰지 않는다', () => {
    const { client, get } = fakeClient({ status: 'offline' })
    const service = createSearchService({ db: () => db, client: () => client })
    const r = service.local('gdesk-demo')
    expect(r.repositories.map((x) => x.id)).toEqual([1])
    expect(r.pullRequests.map((x) => x.id)).toEqual(['p42'])
    expect(service.local('#42').pullRequests.map((x) => x.number)).toEqual([42])
    expect(get).not.toHaveBeenCalled()
  })

  it.each(['', 'g', '  d ', null])('2자 미만(%j)이면 DB 를 읽지 않고 빈 결과', (text) => {
    const service = createSearchService({
      db: () => {
        throw new Error('should not read')
      },
      client: () => fakeClient().client
    })
    expect(service.local(text)).toEqual({ repositories: [], pullRequests: [], issues: [] })
  })

  it('구역마다 최대 10개', () => {
    upsertRepositories(
      db,
      Array.from({ length: 15 }, (_, i) => repoRecord(100 + i, { name: `many-${i}` }))
    )
    const service = createSearchService({ db: () => db, client: () => fakeClient().client })
    expect(service.local('many-').repositories).toHaveLength(10)
  })
})

describe('mapSearchRepository', () => {
  it('owner·name 이 없으면 full_name 에서 나눈다', () => {
    expect(mapSearchRepository({ id: 3, full_name: 'x/y' })).toMatchObject({
      id: 3,
      owner: 'x',
      name: 'y',
      fullName: 'x/y',
      stargazerCount: 0,
      url: ''
    })
  })
})
