import { describe, expect, it } from 'vitest'
import { collectContributors, collectRepositoryDetails, collectStargazers } from './repo-detail'
import { OPERATIONS } from './queries'
import type { RestHandler } from './test-server'
import {
  TEST_BASE,
  fakeGitHub,
  json,
  link,
  orgRestrictionError,
  rawIssue,
  rawPr,
  rawRepo
} from './test-server'

const NOW = Date.UTC(2026, 9, 15, 12)

/** 실제 GitHub 의 Link 주소는 /repositories/{id}/… 를 가리키므로 두 경로에 같은 응답을 건다 */
function both(resource: string, handler: RestHandler): Record<string, RestHandler> {
  return {
    [`GET /repos/acme/widget/${resource}`]: handler,
    [`GET /repositories/10/${resource}`]: handler
  }
}
const DAY = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString()

function detailNode(id: number, patch: Record<string, unknown> = {}) {
  return {
    ...rawRepo(id, { name: 'widget', ownerLogin: 'acme', stargazerCount: 250 }),
    openPullRequests: {
      totalCount: 1,
      nodes: [
        rawPr('PR1', id, { author: { __typename: 'User', login: 'me', avatarUrl: null } }),
        null
      ]
    },
    openIssues: { totalCount: 1, nodes: [rawIssue('I1', id)] },
    defaultBranchRef: {
      name: 'main',
      target: {
        history: {
          nodes: [
            {
              oid: 'a'.repeat(40),
              abbreviatedOid: 'aaaaaaa',
              messageHeadline: 'Fix build',
              committedDate: '2026-10-14T00:00:00Z',
              url: 'https://github.com/acme/widget/commit/aaa',
              author: { name: 'Me', user: { __typename: 'User', login: 'me', avatarUrl: 'av' } },
              statusCheckRollup: { state: 'FAILURE' }
            },
            {
              oid: 'b'.repeat(40),
              abbreviatedOid: 'bbbbbbb',
              messageHeadline: 'Init',
              committedDate: '2026-10-13T00:00:00Z',
              url: 'https://github.com/acme/widget/commit/bbb',
              author: { name: 'Someone', user: null },
              statusCheckRollup: null
            }
          ]
        }
      }
    },
    latestRelease: {
      id: 'RE_2',
      tagName: 'v2.0.0',
      name: 'Two',
      publishedAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-10-01T00:00:00Z',
      isPrerelease: false,
      isDraft: false,
      isLatest: true,
      url: 'https://github.com/acme/widget/releases/tag/v2.0.0'
    },
    releases: {
      totalCount: 5,
      nodes: [
        {
          id: 'RE_3',
          tagName: 'v3.0.0-rc.1',
          name: '',
          publishedAt: '2026-10-10T00:00:00Z',
          createdAt: '2026-10-10T00:00:00Z',
          isPrerelease: true,
          isDraft: false,
          isLatest: false,
          url: 'https://github.com/acme/widget/releases/tag/v3.0.0-rc.1'
        }
      ]
    },
    languages: {
      totalSize: 400,
      edges: [
        { size: 300, node: { name: 'TypeScript', color: '#3178c6' } },
        { size: 100, node: { name: 'CSS', color: null } }
      ]
    },
    ...patch
  }
}

function contributorsRoute() {
  return () =>
    json([{ login: 'a', avatar_url: 'av-a', html_url: 'https://github.com/a', contributions: 9 }])
}

function stargazersRoute(stamps: number[]) {
  return () => json(stamps.map((t, i) => ({ starred_at: iso(t), user: { login: `u${i}` } })))
}

describe('collectRepositoryDetails', () => {
  it('상세 정보를 모두 모아 기록으로 바꾼다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.repositoryDetail]: () => ({
          data: { viewer: { login: 'me' }, node: detailNode(10) }
        })
      },
      rest: {
        'GET /repos/acme/widget/contributors': contributorsRoute(),
        'GET /repos/acme/widget/stargazers': stargazersRoute([NOW - 2 * DAY, NOW - DAY])
      }
    })
    const { results, orgRestrictions } = await collectRepositoryDetails(
      [{ repoId: 10, nodeId: 'R_10' }],
      { client, now: NOW }
    )
    expect(orgRestrictions).toEqual([])
    expect(calls.map((c) => c.key)).toEqual([
      OPERATIONS.repositoryDetail,
      'GET /repos/acme/widget/contributors',
      'GET /repos/acme/widget/stargazers'
    ])
    expect(calls[0]?.graphql?.variables).toMatchObject({ id: 'R_10', commitCount: 7 })
    const stargazerCall = calls[2]!
    expect(stargazerCall.headers.get('accept')).toBe('application/vnd.github.star+json')
    expect(results).toHaveLength(1)
    const r = results[0]!
    if (r.status !== 'ok') throw new Error('expected ok')
    const d = r.detail
    expect(d.repository).toMatchObject({ id: 10, fullName: 'acme/widget', stargazerCount: 250 })
    expect(d.openPullRequests.map((p) => [p.id, p.viewerIsAuthor])).toEqual([['PR1', true]])
    expect(d.openIssues.map((i) => i.id)).toEqual(['I1'])
    expect(d.commits).toEqual([
      {
        sha: 'a'.repeat(40),
        shortSha: 'aaaaaaa',
        message: 'Fix build',
        author: { login: 'me', avatarUrl: 'av', isBot: false },
        authorName: 'Me',
        committedAt: '2026-10-14T00:00:00Z',
        url: 'https://github.com/acme/widget/commit/aaa',
        ciStatus: 'failing'
      },
      expect.objectContaining({ author: null, authorName: 'Someone', ciStatus: 'none' })
    ])
    expect(d.latestRelease).toMatchObject({ tagName: 'v2.0.0', isLatest: true })
    expect(d.releaseCount).toBe(5)
    expect(d.releases[0]).toMatchObject({ tagName: 'v3.0.0-rc.1', isPrerelease: true, name: null })
    expect(d.languages).toEqual([
      { name: 'TypeScript', color: '#3178c6', bytes: 300 },
      { name: 'CSS', color: null, bytes: 100 }
    ])
    expect(d.contributors).toEqual([
      { login: 'a', avatarUrl: 'av-a', url: 'https://github.com/a', contributions: 9 }
    ])
    expect(d.contributorCount).toBe(1)
    expect(d.stargazers.map((s) => s.login)).toEqual(['u0', 'u1'])
    expect(d.starsTruncated).toBe(false)
  })

  it('노드 ID 가 없으면 숫자 ID 로 REST 에서 찾는다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.repositoryDetail]: (vars) => ({
          data: { viewer: { login: 'me' }, node: vars.id === 'R_NEW' ? detailNode(10) : null }
        })
      },
      rest: {
        'GET /repositories/10': () => json({ id: 10, node_id: 'R_NEW', full_name: 'acme/widget' }),
        'GET /repos/acme/widget/contributors': contributorsRoute(),
        'GET /repos/acme/widget/stargazers': stargazersRoute([])
      }
    })
    const { results } = await collectRepositoryDetails([{ repoId: 10 }], { client, now: NOW })
    expect(calls[0]?.key).toBe('GET /repositories/10')
    expect(results[0]?.status).toBe('ok')
  })

  it.each([
    [
      'REST 404',
      { 'GET /repositories/10': () => json({ message: 'Not Found' }, 404) },
      null,
      'not_found'
    ],
    [
      'REST 403',
      { 'GET /repositories/10': () => json({ message: 'Forbidden' }, 403) },
      null,
      'forbidden'
    ]
  ] as const)('%s → unavailable', async (_name, rest, _x, reason) => {
    const { client } = fakeGitHub({ rest })
    const { results } = await collectRepositoryDetails([{ repoId: 10 }], { client, now: NOW })
    expect(results).toEqual([{ repoId: 10, status: 'unavailable', reason }])
  })

  it('GraphQL 노드가 null(삭제·권한 상실) → unavailable, 다른 저장소는 계속', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.repositoryDetail]: (vars) =>
          vars.id === 'R_GONE'
            ? {
                data: { viewer: { login: 'me' }, node: null },
                errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }]
              }
            : { data: { viewer: { login: 'me' }, node: detailNode(10) } }
      },
      rest: {
        'GET /repos/acme/widget/contributors': contributorsRoute(),
        'GET /repos/acme/widget/stargazers': stargazersRoute([])
      }
    })
    const { results } = await collectRepositoryDetails(
      [
        { repoId: 5, nodeId: 'R_GONE' },
        { repoId: 10, nodeId: 'R_10' }
      ],
      { client, now: NOW }
    )
    expect(results.map((r) => [r.repoId, r.status])).toEqual([
      [5, 'unavailable'],
      [10, 'ok']
    ])
  })

  it('조직 제한 → 기록하고 unavailable, 전체는 실패하지 않는다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.repositoryDetail]: () => ({ data: null, errors: [orgRestrictionError('acme')] })
      }
    })
    const { results, orgRestrictions } = await collectRepositoryDetails(
      [{ repoId: 10, nodeId: 'R_10' }],
      { client, now: NOW }
    )
    expect(results).toEqual([{ repoId: 10, status: 'unavailable', reason: 'org_restricted' }])
    expect(orgRestrictions[0]).toMatchObject({ orgLogin: 'acme', reason: 'oauth_app_restriction' })
  })

  it('REST 조직 제한(403 SAML)도 기록한다', async () => {
    const { client } = fakeGitHub({
      rest: {
        'GET /repositories/10': () =>
          json({ message: 'Resource protected by organization SAML enforcement.' }, 403, {
            'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=x'
          })
      }
    })
    const { results, orgRestrictions } = await collectRepositoryDetails([{ repoId: 10 }], {
      client,
      now: NOW
    })
    expect(results[0]).toMatchObject({ status: 'unavailable', reason: 'org_restricted' })
    expect(orgRestrictions[0]).toMatchObject({ orgLogin: 'acme', reason: 'saml_enforcement' })
  })
})

describe('collectStargazers', () => {
  const pageUrl = (n: number): string =>
    `${TEST_BASE}/repositories/10/stargazers?per_page=100&page=${n}`

  it('마지막 페이지부터 거꾸로 걷다가 30일보다 오래된 페이지에서 멈춘다', async () => {
    // 페이지 안은 오래된 → 최신 순. 4쪽: 모두 최근, 3쪽: 첫 항목이 40일 전 → 여기서 멈춤, 2쪽은 받지 않는다
    const pages: Record<string, number[]> = {
      '1': [NOW - 400 * DAY],
      '2': [NOW - 100 * DAY],
      '3': [NOW - 40 * DAY, NOW - 29 * DAY, NOW - 10 * DAY],
      '4': [NOW - 5 * DAY, NOW - DAY]
    }
    const route: RestHandler = (url) => {
      const p = url.searchParams.get('page') ?? '1'
      const n = Number(p)
      const rels: Record<string, string> = { last: pageUrl(4), first: pageUrl(1) }
      if (n > 1) rels.prev = pageUrl(n - 1)
      if (n < 4) rels.next = pageUrl(n + 1)
      return json(
        (pages[p] ?? []).map((t, i) => ({ starred_at: iso(t), user: { login: `p${p}-${i}` } })),
        200,
        { link: link(rels) }
      )
    }
    const { client, calls } = fakeGitHub({ rest: both('stargazers', route) })
    const result = await collectStargazers(client, 'acme/widget', { now: NOW })
    const fetched = calls.map((c) => new URL(c.url).searchParams.get('page') ?? '1')
    expect(fetched).toEqual(['1', '4', '3'])
    expect(result.truncated).toBe(false)
    expect(result.stargazers.map((s) => s.login).sort()).toEqual(['p3-1', 'p3-2', 'p4-0', 'p4-1'])
    expect(result.since).toBe(iso(NOW - 31 * DAY))
  })

  it('한 페이지뿐이면 그 페이지만 쓴다', async () => {
    const { client, calls } = fakeGitHub({
      rest: { 'GET /repos/acme/widget/stargazers': stargazersRoute([NOW - 50 * DAY, NOW - DAY]) }
    })
    const result = await collectStargazers(client, 'acme/widget', { now: NOW })
    expect(calls).toHaveLength(1)
    expect(result.stargazers).toHaveLength(1)
  })

  it('거꾸로 걷다 1쪽에 닿으면 이미 받은 1쪽을 다시 받지 않는다', async () => {
    const { client, calls } = fakeGitHub({
      rest: both('stargazers', (url) => {
        const p = url.searchParams.get('page') ?? '1'
        return json(
          [{ starred_at: iso(NOW - (p === '1' ? 3 : 1) * DAY), user: { login: p } }],
          200,
          {
            link: link(
              p === '1'
                ? { next: pageUrl(2), last: pageUrl(2) }
                : { prev: pageUrl(1), first: pageUrl(1) }
            )
          }
        )
      })
    })
    const result = await collectStargazers(client, 'acme/widget', { now: NOW })
    expect(calls).toHaveLength(2)
    expect(result.stargazers.map((s) => s.login).sort()).toEqual(['1', '2'])
  })

  it('페이지 수 한도에 닿으면 truncated', async () => {
    const { client } = fakeGitHub({
      rest: both('stargazers', (url) => {
        const n = Number(url.searchParams.get('page') ?? '1')
        return json([{ starred_at: iso(NOW - DAY), user: { login: `${n}` } }], 200, {
          link: link({ last: pageUrl(50), ...(n > 1 ? { prev: pageUrl(n - 1) } : {}) })
        })
      })
    })
    const result = await collectStargazers(client, 'acme/widget', { now: NOW, maxPages: 3 })
    expect(result.truncated).toBe(true)
  })

  it('깊은 페이지를 거부(422)하면 truncated 로 두고 실패하지 않는다', async () => {
    const { client } = fakeGitHub({
      rest: both('stargazers', (url) =>
        url.searchParams.get('page') === '500'
          ? json(
              { message: 'In order to keep the API fast for everyone, pagination is limited' },
              422
            )
          : json([{ starred_at: iso(NOW - 900 * DAY), user: { login: 'x' } }], 200, {
              link: link({ last: pageUrl(500) })
            })
      )
    })
    const result = await collectStargazers(client, 'acme/widget', { now: NOW })
    expect(result).toMatchObject({ truncated: true, stargazers: [] })
  })
})

describe('collectContributors', () => {
  it('Link 의 마지막 페이지로 총 인원을 계산한다', async () => {
    const { client, calls } = fakeGitHub({
      rest: both('contributors', (url) =>
        url.searchParams.get('page') === '3'
          ? json(Array.from({ length: 5 }, (_, i) => ({ login: `z${i}`, contributions: 1 })))
          : json(
              Array.from({ length: 20 }, (_, i) => ({
                login: `c${i}`,
                avatar_url: `a${i}`,
                contributions: 20 - i
              })),
              200,
              {
                link: link({
                  next: `${TEST_BASE}/repositories/10/contributors?per_page=20&page=2`,
                  last: `${TEST_BASE}/repositories/10/contributors?per_page=20&page=3`
                })
              }
            )
      )
    })
    const result = await collectContributors(client, 'acme/widget')
    expect(new URL(calls[0]!.url).searchParams.get('anon')).toBe('false')
    expect(result.total).toBe(45)
    expect(result.contributors).toHaveLength(20)
    expect(result.contributors[0]).toEqual({
      login: 'c0',
      avatarUrl: 'a0',
      url: null,
      contributions: 20
    })
  })

  it('빈 저장소(204)·너무 큰 저장소(403)는 빈 목록', async () => {
    const empty = fakeGitHub({
      rest: { 'GET /repos/acme/widget/contributors': () => json(null, 204) }
    })
    expect(await collectContributors(empty.client, 'acme/widget')).toEqual({
      contributors: [],
      total: 0
    })
    const big = fakeGitHub({
      rest: {
        'GET /repos/acme/widget/contributors': () =>
          json(
            { message: 'The history or contributor list is too large to list contributors' },
            403
          )
      }
    })
    expect(await collectContributors(big.client, 'acme/widget')).toEqual({
      contributors: [],
      total: null
    })
  })
})
