import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pollForToken, requestDeviceCode } from '../../src/main/auth/device-flow'
import type { DeviceFlowDeps } from '../../src/main/auth/device-flow'
import { validateToken } from '../../src/main/auth/token-validate'
import { GitHubHttpError, OfflineError, SessionExpiredError } from '../../src/main/github/client'
import type { GitHubClient } from '../../src/main/github/client'
import { createGitHubClientForTests } from '../../src/main/github/client/testing'
import {
  OPERATIONS,
  collectAssignedIssues,
  collectMyIssues,
  collectMyPullRequests,
  collectMyRepositories,
  collectNotifications,
  collectRepoOpenItems,
  collectRepositoryDetails,
  collectReviewRequests,
  collectStarredRepositories
} from '../../src/main/github/collectors'
import { isUnansweredContribution } from '../../src/main/domain/contribution'
import { FIXTURE, startFakeGitHub } from '../fixtures/github'
import type { FakeGitHub } from '../fixtures/github'

// 화면 자동 테스트가 쓰는 가짜 GitHub 서버 자체의 검사.
// 앱의 실제 수집기·인증 코드를 진짜 HTTP 로 이 서버에 붙여, 응답 모양이 앱의 변환기를 통과하는지 본다.

let server: FakeGitHub

beforeAll(async () => {
  server = await startFakeGitHub()
})

afterAll(async () => {
  await server.close()
})

beforeEach(() => {
  server.reset()
})

function client(token: string | null = FIXTURE.token): GitHubClient {
  return createGitHubClientForTests({ baseUrl: server.apiBase, tokenProvider: () => token })
}

function api(path: string, init: RequestInit = {}, token: string | null = FIXTURE.token) {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${server.apiBase}${path}`, { ...init, headers })
}

const R = FIXTURE.repos

describe('라우팅', () => {
  it('GET /user 는 고정 계정과 권한 헤더, 요청 한도 헤더를 준다', async () => {
    const res = await api('/user')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ login: 'octo-maintainer', id: 1001 })
    expect(res.headers.get('x-oauth-scopes')).toBe('repo, read:org, notifications')
    expect(res.headers.get('x-ratelimit-limit')).toBe('5000')
    expect(Number(res.headers.get('x-ratelimit-remaining'))).toBeGreaterThan(4000)
    expect(Number(res.headers.get('x-ratelimit-reset'))).toBeGreaterThan(Date.now() / 1000)
    expect(res.headers.get('x-ratelimit-resource')).toBe('core')
  })

  it('토큰이 없으면 401, 연결 확인(/rate_limit)은 토큰 없이도 200', async () => {
    expect((await api('/user', {}, null)).status).toBe(401)
    const probe = await api('/rate_limit', {}, null)
    expect(probe.status).toBe(200)
    expect(await probe.json()).toMatchObject({ resources: { core: { limit: 5000 } } })
  })

  it('모르는 경로는 404, 모르는 GraphQL 작업은 errors', async () => {
    expect((await api('/nope')).status).toBe(404)
    expect((await fetch(`${server.origin}/elsewhere`)).status).toBe(404)
    const res = await api('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'query X { viewer { login } }', operationName: 'X' })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ errors: [{ message: expect.stringContaining('X') }] })
  })

  it('웹 주소(/web/**)는 실제 GitHub 대신 빈 페이지를 준다', async () => {
    const res = await fetch(`${server.webBase}/octo-maintainer/gdesk-demo/pull/42`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('요청을 기록한다(REST 는 메서드+경로, GraphQL 은 operationName)', async () => {
    const c = client()
    await c.get('/user')
    await collectMyRepositories({ client: c })
    expect(server.requestKeys()).toEqual(['GET /user', `GRAPHQL ${OPERATIONS.myRepositories}`])
    const [user, gql] = server.requests
    expect(user?.token).toBe(FIXTURE.token)
    expect(user?.headers.authorization).toBeUndefined()
    expect(user?.status).toBe(200)
    expect(gql?.variables).toMatchObject({ pageSize: 100 })
    expect(server.hasRequest('GET /user')).toBe(true)
    server.clearRequests()
    expect(server.requests).toEqual([])
  })

  it('이름이 바뀐 저장소는 301 → /repositories/{id} 로 따라간다', async () => {
    const res = await client().get<{ id: number; full_name: string }>(
      `/repos/${FIXTURE.renamedFrom}`
    )
    expect(res.data).toMatchObject({ id: R.demo.id, full_name: R.demo.fullName })
    expect(server.requestKeys()).toEqual([
      `GET /repos/${FIXTURE.renamedFrom}`,
      `GET /repositories/${R.demo.id}`
    ])
  })
})

describe('GraphQL 응답을 앱 수집기가 받아들인다', () => {
  it('내 저장소: 쓰기 권한 저장소만(개인·포크·보관·조직 WRITE), READ 조직 저장소는 빠진다', async () => {
    const result = await collectMyRepositories({ client: client(), pageSize: 2 })
    expect(result.complete).toBe(true)
    expect(result.viewerLogin).toBe('octo-maintainer')
    const byId = new Map(result.items.map((r) => [r.id, r]))
    expect([...byId.keys()].sort()).toEqual([101, 102, 103, 104, 201])
    expect(byId.get(R.fork.id)?.fork).toBe(true)
    expect(byId.get(R.archived.id)?.archived).toBe(true)
    expect(byId.get(R.dotfiles.id)?.private).toBe(true)
    expect(byId.get(R.orgWrite.id)).toMatchObject({
      ownerType: 'Organization',
      viewerPermission: 'WRITE'
    })
    expect(byId.get(R.demo.id)).toMatchObject({
      fullName: R.demo.fullName,
      stargazerCount: 129,
      openPullRequestCount: 4,
      openIssueCount: 3,
      viewerHasStarred: true,
      license: 'MIT',
      topics: ['electron', 'github', 'dashboard']
    })
    // 6 개(READ 포함)를 2 개씩 → 3 쪽
    expect(server.findRequests(`GRAPHQL ${OPERATIONS.myRepositories}`)).toHaveLength(3)
  })

  it('스타한 저장소: 남의 저장소 포함, 스타한 시각 최신순', async () => {
    const result = await collectStarredRepositories({ client: client() })
    expect(result.items.map((s) => s.repository.id)).toEqual([302, 301, 101])
    expect(result.items[1]?.repository).toMatchObject({
      fullName: R.starredOther.fullName,
      viewerPermission: 'READ',
      viewerHasStarred: true
    })
  })

  it('들어온 PR·이슈: 봇, 쓰기 권한자 답글, 응답 없음, 초안', async () => {
    const c = client()
    const repos = (await collectMyRepositories({ client: c })).items
    const { repos: open, viewerLogin } = await collectRepoOpenItems(repos, { client: c })
    expect(viewerLogin).toBe('octo-maintainer')
    const demo = open.find((r) => r.repoId === R.demo.id)
    expect(demo?.pullRequestTotal).toBe(4)
    expect(demo?.issueTotal).toBe(3)
    const pr = (n: number) => demo?.pullRequests.find((p) => p.number === n)
    expect(pr(41)?.author.isBot).toBe(true)
    expect(pr(40)?.hasWriteHolderResponse).toBe(true)
    expect(pr(40)?.ciStatus).toBe('failing')
    expect(pr(42)?.hasWriteHolderResponse).toBe(false)
    expect(pr(39)?.state).toBe('draft')
    expect(pr(39)?.ciStatus).toBe('pending')

    const unanswered = [...(demo?.pullRequests ?? []), ...(demo?.issues ?? [])]
      .filter((i) =>
        isUnansweredContribution({
          authorAssociation: i.authorAssociation,
          authorIsBot: i.author.isBot,
          hasWriteHolderResponse: i.hasWriteHolderResponse
        })
      )
      .map((i) => i.number)
      .sort()
    expect(unanswered).toEqual([39, 42, 45])

    // 열린 항목이 없는 저장소는 요청하지 않고 빈 결과
    expect(open.find((r) => r.repoId === R.dotfiles.id)).toMatchObject({ pullRequestTotal: 0 })
    expect(open.find((r) => r.repoId === R.archived.id)?.issues).toHaveLength(1)
    const core = open.find((r) => r.repoId === R.orgWrite.id)
    expect(core?.pullRequests.map((p) => p.number)).toEqual([13, 12])
  })

  it('모르는 노드 ID 는 그 자리에 null (나머지는 위치대로)', async () => {
    const { repos } = await collectRepoOpenItems(
      [
        { id: 999, nodeId: 'R_missing', openPullRequestCount: 1, openIssueCount: 0 },
        { id: 201, nodeId: 'R_kgDO201', openPullRequestCount: 2, openIssueCount: 2 }
      ],
      { client: client() }
    )
    expect(repos.map((r) => r.repoId)).toEqual([201])
  })

  it('검색 목록: 내 PR(하나는 CI 실패), 리뷰 요청(직접·팀), 할당 이슈, 내 이슈', async () => {
    const c = client()
    const mine = await collectMyPullRequests({ client: c })
    expect(mine.totalCount).toBe(2)
    expect(mine.items.map((p) => `${p.repoFullName}#${p.number}:${p.ciStatus}`).sort()).toEqual([
      'upstream-org/awesome-lib#77:failing',
      'upstream-org/awesome-lib#78:passing'
    ])
    expect(mine.items.every((p) => p.viewerIsAuthor)).toBe(true)
    expect(mine.items.find((p) => p.number === 78)?.reviewStatus).toBe('approved')

    const reviews = await collectReviewRequests({ client: c })
    expect(reviews.items.map((p) => `${p.repoFullName}#${p.number}`).sort()).toEqual([
      'gdesk-org/gdesk-core#12',
      'gdesk-org/gdesk-core#13',
      'upstream-org/awesome-lib#80'
    ])

    const assigned = await collectAssignedIssues({ client: c })
    expect(assigned.items.map((i) => `${i.repoFullName}#${i.number}`).sort()).toEqual([
      'gdesk-org/gdesk-core#8',
      'octo-maintainer/gdesk-demo#44'
    ])

    const myIssues = await collectMyIssues({ client: c })
    expect(myIssues.items.map((i) => `${i.repoFullName}#${i.number}`).sort()).toEqual([
      'octo-maintainer/gdesk-demo#43',
      'upstream-org/awesome-lib#90'
    ])
  })

  it('검색은 커서로 페이지를 나눈다', async () => {
    const result = await collectReviewRequests({ client: client(), pageSize: 1 })
    expect(result.items).toHaveLength(3)
    expect(result.complete).toBe(true)
    expect(server.findRequests(`GRAPHQL ${OPERATIONS.reviewRequests}`)).toHaveLength(3)
  })

  it('저장소 상세: CI 네 상태, 릴리스(프리릴리스 포함), 언어, 기여자 25, 최근 30일 스타', async () => {
    const { results } = await collectRepositoryDetails([{ repoId: R.demo.id }], {
      client: client()
    })
    const outcome = results[0]
    if (outcome?.status !== 'ok') throw new Error('detail failed')
    const d = outcome.detail
    // 노드 ID 가 없으면 REST 로 찾는다
    expect(server.hasRequest(`GET /repositories/${R.demo.id}`)).toBe(true)
    expect(new Set(d.commits.map((c) => c.ciStatus))).toEqual(
      new Set(['passing', 'failing', 'pending', 'none'])
    )
    expect(d.commits).toHaveLength(7)
    expect(d.releaseCount).toBe(4)
    expect(d.latestRelease?.tagName).toBe('v1.2.0')
    expect(d.releases.find((r) => r.isPrerelease)?.tagName).toBe('v1.3.0-beta.1')
    expect(d.languages.map((l) => l.name)).toEqual(['TypeScript', 'CSS', 'JavaScript', 'Shell'])
    expect(d.contributorCount).toBe(25)
    expect(d.contributors).toHaveLength(20)
    expect(d.contributors[0]?.login).toBe('octo-maintainer')
    expect(d.stargazers).toHaveLength(28)
    expect(d.starsTruncated).toBe(false)
    const spanDays =
      (Date.now() - Math.min(...d.stargazers.map((s) => Date.parse(s.starredAt)))) / 86_400_000
    expect(spanDays).toBeGreaterThan(25)
    expect(spanDays).toBeLessThan(31)
    expect(d.openPullRequests).toHaveLength(4)
    expect(d.openIssues).toHaveLength(3)
    expect(d.repository.stargazerCount).toBe(129)
  })

  it('스타가 여러 쪽이면 Link last 로 마지막 쪽부터 읽고 기준보다 오래된 쪽에서 멈춘다', async () => {
    const { results } = await collectRepositoryDetails(
      [{ repoId: R.starredOther.id, nodeId: 'R_kgDO301' }],
      { client: client() }
    )
    const outcome = results[0]
    if (outcome?.status !== 'ok') throw new Error('detail failed')
    // 최근 4 + 20일 전에 내가 스타
    expect(outcome.detail.stargazers).toHaveLength(5)
    const pages = server
      .findRequests((r) => r.path.endsWith('/stargazers'))
      .map((r) => r.query.page ?? '1')
    expect(pages).toEqual(['1', '3'])
    expect(server.findRequests((r) => r.path.endsWith('/stargazers'))[0]?.headers.accept).toContain(
      'star+json'
    )
  })

  it('없는 저장소 상세는 unavailable', async () => {
    const { results } = await collectRepositoryDetails([{ repoId: 999 }], { client: client() })
    expect(results[0]).toMatchObject({ status: 'unavailable', reason: 'not_found' })
  })
})

describe('알림과 쓰기 동작', () => {
  it('알림: 읽음·안 읽음 모두, 여러 쪽, 이유 여러 가지, 조건부 요청 304', async () => {
    const c = client()
    const first = await collectNotifications({ client: c, perPage: 4 })
    if (first.notModified) throw new Error('unexpected 304')
    expect(first.complete).toBe(true)
    expect(first.notifications).toHaveLength(9)
    expect(first.notifications.filter((n) => n.state === 'unread')).toHaveLength(6)
    expect(new Set(first.notifications.map((n) => n.reason)).size).toBeGreaterThanOrEqual(8)
    expect(first.pollInterval).toBe(60)
    expect(first.etag).toBeTruthy()
    const pr = first.notifications.find((n) => n.threadId === '9001')
    expect(pr).toMatchObject({
      repoId: R.orgWrite.id,
      repoFullName: R.orgWrite.fullName,
      url: `${server.webBase}/gdesk-org/gdesk-core/pull/13`
    })
    expect(server.findRequests('GET /notifications').map((r) => r.query.page ?? '1')).toEqual([
      '1',
      '2',
      '3'
    ])

    const again = await collectNotifications({
      client: c,
      perPage: 4,
      etag: first.etag,
      lastModified: first.lastModified
    })
    expect(again.notModified).toBe(true)

    // 읽음(205) → 바뀐 응답
    await c.patch('/notifications/threads/9001')
    // 완료(204) → 목록에서 빠짐
    await c.delete('/notifications/threads/9002')
    const after = await collectNotifications({
      client: c,
      perPage: 4,
      etag: first.etag,
      lastModified: first.lastModified
    })
    if (after.notModified) throw new Error('expected changes')
    expect(after.notifications).toHaveLength(8)
    expect(after.notifications.find((n) => n.threadId === '9001')?.state).toBe('read')
    expect(after.notifications.find((n) => n.threadId === '9002')).toBeUndefined()
    expect(server.findRequests('PATCH /notifications/threads/9001')[0]?.status).toBe(205)
    expect(server.findRequests('DELETE /notifications/threads/9002')[0]?.status).toBe(204)
  })

  it('스타·스타 취소는 viewerHasStarred 와 스타 수를 바꾼다', async () => {
    const c = client()
    const put = await c.put(`/user/starred/${R.dotfiles.fullName}`)
    expect(put.status).toBe(204)
    await c.delete(`/user/starred/${R.starredOther.fullName}`)
    const mine = await collectMyRepositories({ client: c })
    expect(mine.items.find((r) => r.id === R.dotfiles.id)).toMatchObject({
      viewerHasStarred: true,
      stargazerCount: 1
    })
    const starred = await collectStarredRepositories({ client: c })
    expect(starred.items.map((s) => s.repository.id)).toEqual([102, 302, 101])
    const repo = await c.get<{ stargazers_count: number }>(`/repos/${R.starredOther.fullName}`)
    expect(repo.data.stargazers_count).toBe(254)
  })
})

describe('조종 API', () => {
  it('failNextWrites: 다음 쓰기만 실패하고 상태는 그대로', async () => {
    const c = client()
    server.failNextWrites(1)
    await expect(c.put(`/user/starred/${R.dotfiles.fullName}`)).rejects.toMatchObject({
      status: 500
    })
    // GET 은 영향 없음
    await c.get('/user')
    expect(server.state.repos.find((r) => r.id === R.dotfiles.id)?.viewerStarredAt).toBeNull()
    await c.put(`/user/starred/${R.dotfiles.fullName}`)
    expect(server.state.repos.find((r) => r.id === R.dotfiles.id)?.viewerStarredAt).not.toBeNull()
  })

  it('failNext: 조건에 맞는 요청을 원하는 상태로 실패시킨다', async () => {
    server.failNext(1, { status: 502, match: `GRAPHQL ${OPERATIONS.myRepositories}` })
    const c = client()
    await expect(collectMyRepositories({ client: c })).rejects.toBeInstanceOf(GitHubHttpError)
    expect((await collectMyRepositories({ client: c })).items).toHaveLength(5)
  })

  it('오프라인 → 네트워크 오류(offline), 다시 온라인이면 회복', async () => {
    const c = client()
    await c.get('/user') // 연결을 하나 열어 둔다(keep-alive)
    server.goOffline()
    await expect(c.get('/user')).rejects.toBeInstanceOf(OfflineError)
    expect(c.getStatus()).toBe('offline')
    expect(await c.checkConnectivity()).toBe('offline')
    server.goOnline()
    expect(await c.checkConnectivity()).toBe('online')
    await c.get('/user')
  })

  it('401 모드 → 세션 만료', async () => {
    const c = client()
    server.setUnauthorized(true)
    await expect(c.get('/user')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(c.getStatus()).toBe('session_expired')
    server.setUnauthorized(false)
    await expect(
      validateToken(FIXTURE.invalidToken, { fetch, apiBase: server.apiBase })
    ).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('토큰 확인: 기본은 classic + 모든 권한, 권한 헤더를 바꿀 수 있다', async () => {
    const ok = await validateToken(FIXTURE.token, { fetch, apiBase: server.apiBase })
    expect(ok).toMatchObject({
      user: { id: 1001, login: 'octo-maintainer', name: 'Octo Maintainer' },
      tokenKind: 'classic',
      scopes: ['repo', 'read:org', 'notifications']
    })
    server.setScopes('repo')
    expect((await validateToken(FIXTURE.token, { fetch, apiBase: server.apiBase })).scopes).toEqual(
      ['repo']
    )
  })

  it('세분화 토큰 모드: 권한 헤더 없음 + /notifications 403', async () => {
    server.setFineGrained(true)
    const v = await validateToken(FIXTURE.token, { fetch, apiBase: server.apiBase })
    expect(v.scopes).toBeNull()
    expect(v.tokenKind).toBe('fine_grained')
    await expect(collectNotifications({ client: client() })).rejects.toMatchObject({
      status: 403
    })
    server.setFineGrained(false)
    expect((await validateToken(FIXTURE.token, { fetch, apiBase: server.apiBase })).scopes).toEqual(
      ['repo', 'read:org', 'notifications']
    )
  })

  it('reset: 데이터·모드·기록을 처음으로', async () => {
    const c = client()
    await c.delete('/notifications/threads/9001')
    server.setUnauthorized(true)
    server.reset()
    expect(server.requests).toEqual([])
    const n = await collectNotifications({ client: c })
    if (n.notModified) throw new Error('unexpected 304')
    expect(n.notifications).toHaveLength(9)
  })

  it('waitForRequest: 이미 왔거나 앞으로 올 요청을 기다린다', async () => {
    const pending = server.waitForRequest('GET /rate_limit', 2000)
    await client().checkConnectivity()
    expect((await pending).status).toBe(200)
    await expect(server.waitForRequest('GET /never', 50)).rejects.toThrow(/no request/)
  })

  it('setRateLimit: 남은 한도를 고정한다', async () => {
    server.setRateLimit({ remaining: 3 })
    const c = client()
    await c.get('/user')
    expect(c.getRateLimit('core')).toMatchObject({ remaining: 3, limit: 5000 })
    expect(c.isRateLimitLow('core')).toBe(true)
  })
})

describe('기기 인증(device flow)', () => {
  const deps = (): DeviceFlowDeps => ({
    fetch,
    webBase: server.webBase,
    clientId: 'test-client-id',
    now: Date.now,
    sleep: async () => undefined
  })

  it('코드를 받고, 승인 전에는 대기, 승인하면 토큰', async () => {
    const signal = new AbortController().signal
    const code = await requestDeviceCode(deps(), signal)
    expect(code).toMatchObject({
      userCode: FIXTURE.deviceUserCode,
      verificationUri: `${server.webBase}/login/device`,
      intervalMs: 1000
    })
    let polls = 0
    const d = deps()
    const outcome = await pollForToken(
      {
        ...d,
        sleep: async () => {
          if (++polls === 3) server.approveDeviceFlow()
        }
      },
      code,
      signal
    )
    expect(outcome).toEqual({ kind: 'success', token: FIXTURE.deviceToken })
    expect(server.findRequests('WEB POST /login/oauth/access_token')).toHaveLength(3)
    const v = await validateToken(FIXTURE.deviceToken, { fetch, apiBase: server.apiBase })
    expect(v.tokenKind).toBe('oauth')
  })

  it('거부·만료', async () => {
    const signal = new AbortController().signal
    const code = await requestDeviceCode(deps(), signal)
    server.setDeviceFlowOutcome('deny')
    expect(await pollForToken(deps(), code, signal)).toEqual({ kind: 'denied' })
    server.setDeviceFlowOutcome('expire')
    expect(await pollForToken(deps(), code, signal)).toEqual({ kind: 'expired' })
  })
})
