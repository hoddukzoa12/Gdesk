import type { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canCommentOnIssue } from '../../src/shared/domain/issue-detail'
import { prDisplayStatus } from '../../src/shared/domain/home-activity'
import { validateToken } from '../../src/main/auth/token-validate'
import { createIssueActionsService } from '../../src/main/actions/issue-actions.service'
import type { IssueActionsService } from '../../src/main/actions/issue-actions.service'
import { getIssueDetail } from '../../src/main/cache'
import { openDatabase } from '../../src/main/db/connection'
import { contributionStreak } from '../../src/main/domain/home-activity'
import {
  GraphQLError,
  OfflineError,
  RateLimitedError,
  SessionExpiredError
} from '../../src/main/github/client'
import type { GitHubClient } from '../../src/main/github/client'
import { createGitHubClientForTests } from '../../src/main/github/client/testing'
import {
  OPERATIONS,
  collectContributions,
  collectIssueDetail,
  collectMentionedIssues,
  collectMyIssues,
  collectMyPullRequests,
  collectMyRepositories,
  collectRecentCommits,
  collectRepoOpenItems,
  refreshIssueDetail,
  refreshMyRepositories
} from '../../src/main/github/collectors'
import { ADD_COMMENT_MUTATION, ISSUE_DETAIL_QUERY } from '../../src/main/github/collectors/queries'
import { FIXTURE, MALICIOUS_BODY_MARKERS, startFakeGitHub } from '../fixtures/github'
import type { FakeGitHub } from '../fixtures/github'

// 가짜 서버의 Home 활동·이슈 읽기·이슈 쓰기 응답을 앱의 실제 수집기·서비스로 진짜 HTTP 를 거쳐 확인한다.

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

function client(): GitHubClient {
  return createGitHubClientForTests({ baseUrl: server.apiBase, tokenProvider: () => FIXTURE.token })
}

function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${FIXTURE.token}`)
  return fetch(`${server.apiBase}${path}`, { ...init, headers })
}

const R = FIXTURE.repos
const V = FIXTURE.viewer.login
const DEMO = { repoId: R.demo.id, fullName: R.demo.fullName }
const key = (i: { repoFullName: string; number: number }) => `${i.repoFullName}#${i.number}`

describe('Home 활동', () => {
  it('기여 달력: 일요일 시작 ~ 오늘(UTC), 다섯 수준, 커밋 수 고정, 연속 5일', async () => {
    const result = await collectContributions({ client: client() })
    expect(result.login).toBe(V)
    expect(result.totalCommitContributions).toBe(FIXTURE.contributions.totalCommits)
    const days = result.days
    expect(days.length).toBeGreaterThanOrEqual(365)
    expect(days.length).toBeLessThanOrEqual(371)
    expect(new Date(`${days[0]?.date}T00:00:00Z`).getUTCDay()).toBe(0)
    expect(days.at(-1)?.date).toBe(new Date().toISOString().slice(0, 10))
    expect(days.at(-1)?.count).toBe(0)
    expect(new Set(days.map((d) => d.level))).toEqual(
      new Set(['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'])
    )
    expect(contributionStreak(days)).toBe(FIXTURE.contributions.streak)
    // 53 주
    const weeks = server.state.contributions.weeks
    expect(weeks).toHaveLength(53)
    expect(weeks.slice(0, -1).every((w) => w.contributionDays.length === 7)).toBe(true)
  })

  it('최근 커밋: author 검색, 작성 시각 최신순, 첫 줄만, 검색 한도', async () => {
    const commits = await collectRecentCommits({ client: client(), login: V })
    expect(commits.map((c) => c.message)).toEqual(FIXTURE.recentCommitMessages)
    expect(commits[0]).toMatchObject({
      repoFullName: R.demo.fullName,
      url: expect.stringContaining(`${server.webBase}/${R.demo.fullName}/commit/`)
    })
    expect(commits[0]?.authorAvatarUrl).toMatch(/^data:image/)
    expect(commits[0]?.authorLogin).toBe(V)
    const req = server.findRequests('GET /search/commits')[0]
    expect(req?.query).toMatchObject({
      q: `author:${V}`,
      sort: 'author-date',
      order: 'desc',
      per_page: '5'
    })
    const res = await api(`/search/commits?q=author:${V}&per_page=2`)
    expect(res.headers.get('x-ratelimit-resource')).toBe('search')
    expect(res.headers.get('link')).toContain('rel="next"')
    expect(await res.json()).toMatchObject({
      total_count: FIXTURE.recentCommitTotal,
      incomplete_results: false
    })

    const alice = await collectRecentCommits({ client: client(), login: FIXTURE.users.alice })
    expect(alice.map((c) => c.message)).toEqual([
      'Update notification polling',
      'Fix flaky cache test'
    ])
  })

  it('내 PR 표시 상태: 301#77 review_required, 301#78 approved', async () => {
    const mine = await collectMyPullRequests({ client: client() })
    expect(Object.fromEntries(mine.items.map((p) => [key(p), prDisplayStatus(p)]))).toEqual({
      'upstream-org/awesome-lib#77': 'review_required',
      'upstream-org/awesome-lib#78': 'approved'
    })
  })
})

describe('이슈 읽기', () => {
  it('언급된 이슈 셋, 담당자 여러 명, 이슈 기능이 꺼진 저장소', async () => {
    const c = client()
    const mentioned = await collectMentionedIssues({ client: c })
    expect(mentioned.items.map(key)).toEqual(FIXTURE.mentionedIssues)
    expect(mentioned.totalCount).toBe(3)
    const assignees = Object.fromEntries(
      mentioned.items.map((i) => [key(i), i.assignees.map((a) => a.login)])
    )
    expect(assignees).toEqual({
      'octo-maintainer/gdesk-demo#45': [FIXTURE.users.alice],
      'gdesk-org/gdesk-core#7': [FIXTURE.users.alice, FIXTURE.users.dave],
      'upstream-org/awesome-lib#91': []
    })
    const repos = await collectMyRepositories({ client: c })
    const disabled = repos.items.filter((r) => !r.hasIssuesEnabled).map((r) => r.id)
    expect(disabled).toEqual([FIXTURE.issuesDisabledRepo.id])
    const rest = await c.get<{ has_issues: boolean }>(`/repositories/${R.dotfiles.id}`)
    expect(rest.data.has_issues).toBe(false)
  })

  it('101#45 상세: 본문(이미지·체크박스·링크·코드·악성 예시), 코멘트, 반응, 연결 PR, 참조 커밋', async () => {
    const outcome = await collectIssueDetail({ ...DEMO, number: 45 }, { client: client() })
    if (outcome.status !== 'ok') throw new Error('detail failed')
    const d = outcome.detail
    expect(d).toMatchObject({
      id: 'I_kwDO101_45',
      title: 'App freezes on large notification lists',
      state: 'open',
      stateReason: null,
      locked: false,
      viewerCanClose: true,
      viewerCanReopen: false,
      viewerCanReact: true,
      viewerPermission: 'ADMIN',
      commentCount: 3,
      url: `${server.webBase}/${R.demo.fullName}/issues/45`
    })
    expect(d.author.login).toBe(FIXTURE.users.bob)
    expect(d.labels).toEqual([{ name: 'bug', color: 'd73a4a' }])
    expect(d.assignees.map((a) => a.login)).toEqual([FIXTURE.users.alice])
    expect(d.bodyHTML).toContain('<img src="data:image/png;base64,')
    expect(d.bodyHTML).toContain('task-list-item-checkbox')
    expect(d.bodyHTML).toContain('<a href="https://docs.github.com/')
    expect(d.bodyHTML).toContain('<pre><code')
    expect(d.bodyHTML).toContain('<script>')
    expect(d.bodyHTML).toContain(`onerror="${MALICIOUS_BODY_MARKERS.onerror}`)
    expect(d.bodyHTML).toContain(`href="${MALICIOUS_BODY_MARKERS.javascriptHref}"`)
    expect(d.reactions).toEqual(
      expect.arrayContaining([
        { content: 'THUMBS_UP', count: 3, viewerHasReacted: false },
        { content: 'EYES', count: 1, viewerHasReacted: true },
        { content: 'HEART', count: 1, viewerHasReacted: false }
      ])
    )
    expect(d.reactions).toHaveLength(8)
    expect(d.comments.map((c) => [c.id, c.author.login])).toEqual([
      ['IC_kwDO101_45_1', FIXTURE.users.alice],
      ['IC_kwDO101_45_2', FIXTURE.users.bob],
      ['IC_kwDO101_45_3', FIXTURE.users.carol]
    ])
    expect(d.comments[0]?.reactions).toEqual(
      expect.arrayContaining([{ content: 'THUMBS_UP', count: 2, viewerHasReacted: true }])
    )
    expect(d.comments[2]?.bodyHTML).toContain('onerror=')
    expect(d.linkedPullRequests.map((p) => `#${p.number}:${p.state}`)).toEqual([
      '#42:open',
      '#38:merged',
      '#37:closed'
    ])
    expect(d.referencingCommits.map((c) => c.message)).toEqual([
      'Throttle notification list updates (refs #45)',
      'Add a benchmark for 1000 notifications'
    ])
    expect(d.referencingCommits[0]?.repoFullName).toBe(R.demo.fullName)
    const vars = server.findRequests(`GRAPHQL ${OPERATIONS.issueDetail}`)[0]?.variables
    expect(vars).toMatchObject({ owner: 'octo-maintainer', name: 'gdesk-demo', number: 45 })
  })

  it('타임라인은 last 처럼 끝에서부터 timelineCount 개를 준다(시간 순서는 그대로)', async () => {
    const res = await api('/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: ISSUE_DETAIL_QUERY,
        operationName: OPERATIONS.issueDetail,
        variables: {
          owner: 'octo-maintainer',
          name: 'gdesk-demo',
          number: 45,
          commentCount: 100,
          labelCount: 50,
          closingCount: 25,
          timelineCount: 2
        }
      })
    })
    const body = (await res.json()) as {
      data: { repository: { issue: { timelineItems: { nodes: { commit?: { oid: string } }[] } } } }
    }
    expect(
      body.data.repository.issue.timelineItems.nodes.map((n) => n.commit?.oid.slice(0, 4))
    ).toEqual(['f45a', 'f45b'])
  })

  it('201#7: 연결 후 연결 해제한 PR 은 빠진다. 다른 이슈도 기본 상세가 나온다', async () => {
    const c = client()
    const core = await collectIssueDetail(
      { repoId: R.orgWrite.id, fullName: R.orgWrite.fullName, number: 7 },
      { client: c }
    )
    if (core.status !== 'ok') throw new Error('detail failed')
    expect(core.detail.linkedPullRequests.map((p) => `#${p.number}:${p.state}`)).toEqual([
      '#14:open'
    ])
    expect(core.detail.viewerPermission).toBe('WRITE')
    expect(core.detail.bodyHTML).toContain('<pre><code>')

    const plain = await collectIssueDetail({ ...DEMO, number: 43 }, { client: c })
    if (plain.status !== 'ok') throw new Error('detail failed')
    expect(plain.detail).toMatchObject({ bodyHTML: '<p>Roadmap for v2</p>', commentCount: 0 })
  })

  it('잠긴 이슈(301#91, READ): 코멘트·반응·닫기 불가', async () => {
    const outcome = await collectIssueDetail(
      {
        repoId: FIXTURE.lockedIssue.repoId,
        fullName: FIXTURE.lockedIssue.fullName,
        number: FIXTURE.lockedIssue.number
      },
      { client: client() }
    )
    if (outcome.status !== 'ok') throw new Error('detail failed')
    const d = outcome.detail
    expect(d).toMatchObject({
      locked: true,
      viewerPermission: 'READ',
      viewerCanClose: false,
      viewerCanReopen: false,
      viewerCanReact: false
    })
    expect(canCommentOnIssue(d.locked, d.viewerPermission)).toBe(false)
  })

  it('PR 번호·없는 저장소는 not_found, 캐시에 없는 저장소는 GET /repositories/{id} 로 찾는다', async () => {
    const c = client()
    expect((await collectIssueDetail({ ...DEMO, number: 42 }, { client: c })).status).toBe(
      'not_found'
    )
    expect(
      (
        await collectIssueDetail(
          { repoId: 9, fullName: 'nobody/nothing', number: 1 },
          { client: c }
        )
      ).status
    ).toBe('not_found')

    const db = openDatabase(':memory:')
    try {
      const result = await refreshIssueDetail({ db, client: c, repoId: 301, number: 91 })
      expect(result.status).toBe('ok')
      expect(server.hasRequest('GET /repositories/301')).toBe(true)
      expect(getIssueDetail(db, 301, 91)?.viewerCanComment).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('이슈 쓰기(앱의 이슈 쓰기 서비스)', () => {
  let db: DatabaseSync
  let service: IssueActionsService
  let c: GitHubClient
  const REF = { repoId: R.demo.id, number: 45 }

  beforeEach(async () => {
    db = openDatabase(':memory:')
    c = client()
    await refreshMyRepositories({ db, client: c })
    await refreshIssueDetail({ db, client: c, ...REF })
    service = createIssueActionsService({
      db: () => db,
      client: c,
      getSession: () => ({ state: 'signed_in' }),
      notify: vi.fn()
    })
    server.clearRequests()
  })

  afterEach(() => db.close())

  async function fetchDetail(number = 45) {
    const outcome = await collectIssueDetail({ ...DEMO, number }, { client: c })
    if (outcome.status !== 'ok') throw new Error('detail failed')
    return outcome.detail
  }

  it('반응 더하기·빼기: 수와 viewerHasReacted 가 서버 상태에 남는다(이슈·코멘트)', async () => {
    expect(
      await service.react({
        subjectId: 'I_kwDO101_45',
        issueRef: REF,
        content: 'THUMBS_UP',
        add: true
      })
    ).toEqual({ ok: true })
    expect(
      await service.react({ subjectId: 'I_kwDO101_45', issueRef: REF, content: 'EYES', add: false })
    ).toEqual({ ok: true })
    expect(
      await service.react({
        subjectId: 'IC_kwDO101_45_2',
        issueRef: REF,
        content: 'ROCKET',
        add: true
      })
    ).toEqual({ ok: true })
    expect(server.requestKeys()).toEqual([
      `GRAPHQL ${OPERATIONS.addReaction}`,
      `GRAPHQL ${OPERATIONS.removeReaction}`,
      `GRAPHQL ${OPERATIONS.addReaction}`
    ])
    const d = await fetchDetail()
    expect(d.reactions).toEqual(
      expect.arrayContaining([
        { content: 'THUMBS_UP', count: 4, viewerHasReacted: true },
        { content: 'EYES', count: 0, viewerHasReacted: false }
      ])
    )
    expect(d.comments[1]?.reactions).toEqual(
      expect.arrayContaining([{ content: 'ROCKET', count: 1, viewerHasReacted: true }])
    )
  })

  it('failNextWrites 는 GraphQL mutation 도 실패시키고 상태·캐시는 그대로', async () => {
    server.failNextWrites(1)
    const result = await service.react({
      subjectId: 'I_kwDO101_45',
      issueRef: REF,
      content: 'HOORAY',
      add: true
    })
    expect(result).toMatchObject({ ok: false, reason: 'failed' })
    expect(server.findRequests(`GRAPHQL ${OPERATIONS.addReaction}`)[0]?.status).toBe(500)
    expect(server.state.items.find((i) => i.nodeId === 'I_kwDO101_45')?.reactions?.HOORAY).toBe(
      undefined
    )
    expect(getIssueDetail(db, 101, 45)?.reactions.find((r) => r.content === 'HOORAY')?.count).toBe(
      0
    )
    // GraphQL 조회는 쓰기로 세지 않는다
    server.failNextWrites(1)
    await fetchDetail()
    expect(await service.comment({ issueRef: REF, body: 'x' })).toMatchObject({ ok: false })
  })

  it('코멘트: 이스케이프한 <p> 본문으로 붙고, 상세·목록 코멘트 수가 늘어난다', async () => {
    const result = await service.comment({
      issueRef: REF,
      body: 'Looks good <b>now</b> **thanks**'
    })
    expect(result).toEqual({ ok: true })
    const cached = getIssueDetail(db, 101, 45)
    expect(cached?.commentCount).toBe(4)
    const added = cached?.comments.at(-1)
    expect(added).toMatchObject({ id: 'IC_kwDO101_45_4', author: { login: V } })
    expect(added?.bodyHTML).toBe('<p>Looks good &lt;b&gt;now&lt;/b&gt; <strong>thanks</strong></p>')
    const d = await fetchDetail()
    expect(d.comments.at(-1)?.id).toBe('IC_kwDO101_45_4')
    const repos = (await collectMyRepositories({ client: c })).items
    const { repos: open } = await collectRepoOpenItems(repos, { client: c })
    const issue = open.find((r) => r.repoId === 101)?.issues.find((i) => i.number === 45)
    expect(issue?.commentCount).toBe(4)
    // 내(OWNER) 코멘트가 붙었으니 이제 응답한 기여
    expect(issue?.hasWriteHolderResponse).toBe(true)
  })

  it('잠긴 READ 이슈: 앱은 not_allowed, 서버도 addComment 를 거부한다', async () => {
    await refreshIssueDetail({ db, client: c, repoId: 301, number: 91 })
    expect(await service.comment({ issueRef: { repoId: 301, number: 91 }, body: 'hi' })).toEqual({
      ok: false,
      reason: 'not_allowed'
    })
    await expect(
      c.graphql(
        ADD_COMMENT_MUTATION,
        { subjectId: 'I_kwDO301_91', body: 'hi' },
        { operationName: OPERATIONS.addComment }
      )
    ).rejects.toBeInstanceOf(GraphQLError)
    expect(server.state.items.find((i) => i.nodeId === 'I_kwDO301_91')?.comments).toHaveLength(1)
  })

  it('닫기 → 열린 목록·검색·열린 수에서 빠지고, 다시 열면 돌아온다', async () => {
    expect(
      await service.setState({ issueRef: REF, state: 'closed', reason: 'not_planned' })
    ).toEqual({ ok: true })
    expect(server.findRequests(`GRAPHQL ${OPERATIONS.closeIssue}`)[0]?.variables).toEqual({
      issueId: 'I_kwDO101_45',
      stateReason: 'NOT_PLANNED'
    })
    const closed = await fetchDetail()
    expect(closed).toMatchObject({
      state: 'closed',
      stateReason: 'not_planned',
      viewerCanClose: false,
      viewerCanReopen: true
    })
    const mentioned = await collectMentionedIssues({ client: c })
    expect(mentioned.items.map(key)).not.toContain('octo-maintainer/gdesk-demo#45')
    const repos = (await collectMyRepositories({ client: c })).items
    expect(repos.find((r) => r.id === 101)?.openIssueCount).toBe(2)
    const { repos: open } = await collectRepoOpenItems(repos, { client: c })
    expect(open.find((r) => r.repoId === 101)?.issues.map((i) => i.number)).toEqual([44, 43])

    expect(await service.setState({ issueRef: REF, state: 'open' })).toEqual({ ok: true })
    expect((await fetchDetail()).state).toBe('open')
    expect((await collectMentionedIssues({ client: c })).items.map(key)).toContain(
      'octo-maintainer/gdesk-demo#45'
    )
  })

  it('새 이슈: 201, 저장소 목록에는 바로, 검색(내 이슈)에는 indexCreatedIssues() 뒤에', async () => {
    const result = await service.create({
      repoId: 101,
      title: 'Created from Gdesk',
      body: 'Body **text**',
      labels: ['bug', 'brand-new'],
      assignees: [V, 'stranger']
    })
    expect(result).toEqual({ ok: true, issue: { repoId: 101, number: 46, nodeId: 'I_kwDO101_46' } })
    const req = server.findRequests('POST /repos/octo-maintainer/gdesk-demo/issues')[0]
    expect(req?.status).toBe(201)
    expect(req?.body).toEqual({
      title: 'Created from Gdesk',
      body: 'Body **text**',
      labels: ['bug', 'brand-new'],
      assignees: [V, 'stranger']
    })
    const item = server.state.items.find((i) => i.nodeId === 'I_kwDO101_46')
    expect(item).toMatchObject({
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'brand-new', color: 'ededed' }
      ],
      assignees: [V],
      authorAssociation: 'OWNER'
    })

    const before = await collectMyIssues({ client: c })
    expect(before.items.map(key)).not.toContain('octo-maintainer/gdesk-demo#46')
    const repos = (await collectMyRepositories({ client: c })).items
    const { repos: open } = await collectRepoOpenItems(repos, { client: c })
    expect(open.find((r) => r.repoId === 101)?.issues.map((i) => i.number)).toContain(46)

    server.indexCreatedIssues()
    const after = await collectMyIssues({ client: c })
    expect(after.items.map(key)).toContain('octo-maintainer/gdesk-demo#46')
    expect((await fetchDetail(46)).bodyHTML).toBe('<p>Body <strong>text</strong></p>')
  })

  it('setSearchIndexDelay: 지연이 지나면 검색에 나온다', async () => {
    server.setSearchIndexDelay(0)
    await service.create({ repoId: 101, title: 'Indexed at once' })
    expect((await collectMyIssues({ client: c })).items.map((i) => i.title)).toContain(
      'Indexed at once'
    )
  })

  it('이슈 기능이 꺼진 저장소: 앱은 막고, 서버는 410', async () => {
    expect(await service.create({ repoId: R.dotfiles.id, title: 'x' })).toEqual({
      ok: false,
      reason: 'repo_issues_disabled'
    })
    const res = await api(`/repos/${R.dotfiles.fullName}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: 'x' })
    })
    expect(res.status).toBe(410)
    const missing = await api(`/repos/${R.demo.fullName}/issues`, {
      method: 'POST',
      body: JSON.stringify({ body: 'no title' })
    })
    expect(missing.status).toBe(422)
  })

  it('라벨·담당자 선택지와 Link 페이지 나누기', async () => {
    const meta = await service.repoMeta(101)
    if (!meta.ok) throw new Error('repoMeta failed')
    expect(meta.labels).toHaveLength(11)
    expect(meta.labels.find((l) => l.name === 'bug')).toEqual({
      name: 'bug',
      color: 'd73a4a',
      description: "Something isn't working"
    })
    expect(meta.labels.find((l) => l.name === 'meta')?.description).toBeNull()
    expect(meta.assignees.map((a) => a.login)).toEqual([V, FIXTURE.users.alice, FIXTURE.users.bob])
    expect(server.findRequests('GET /repos/octo-maintainer/gdesk-demo/labels')[0]?.query).toEqual({
      per_page: '100'
    })

    const page1 = await api(`/repos/${R.demo.fullName}/labels?per_page=4`)
    expect(page1.headers.get('link')).toContain('rel="last"')
    const all = await c.getAllPages<{ name: string }>(`/repos/${R.demo.fullName}/labels`, {
      query: { per_page: 4 }
    })
    expect(all).toHaveLength(11)
    const assignees = await c.getAllPages<{ login: string }>(
      `/repos/${R.demo.fullName}/assignees`,
      { query: { per_page: 1 } }
    )
    expect(assignees.map((a) => a.login)).toEqual([V, FIXTURE.users.alice, FIXTURE.users.bob])
  })

  it('마크다운 미리보기: 서버 표식과 이스케이프, 쓰기로 세지 않는다', async () => {
    server.failNextWrites(1)
    const result = await service.previewMarkdown(101, 'Hello **world** <script>x</script>')
    expect(result).toEqual({
      ok: true,
      html: '<div data-fake-markdown="gfm" data-context="octo-maintainer/gdesk-demo"><p>Hello <strong>world</strong> &lt;script&gt;x&lt;/script&gt;</p></div>'
    })
    const res = await api('/markdown', { method: 'POST', body: JSON.stringify({ text: 'a' }) })
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})

describe('조종 API(새 경로)', () => {
  it('GET /user email: 기본 공개 이메일, setUserEmail 로 바꾸기, reset 으로 되돌리기', async () => {
    const v = await validateToken(FIXTURE.token, { fetch, apiBase: server.apiBase })
    expect(v.user.email).toBe(FIXTURE.viewer.email)
    server.setUserEmail(null)
    expect(
      (await validateToken(FIXTURE.token, { fetch, apiBase: server.apiBase })).user.email
    ).toBe(null)
    server.setUserEmail('other@example.test')
    expect((await (await api('/user')).json()) as { email: string }).toMatchObject({
      email: 'other@example.test'
    })
    server.reset()
    expect(((await (await api('/user')).json()) as { email: string }).email).toBe(
      FIXTURE.viewer.email
    )
  })

  it('failNext·오프라인·401·한도 초과가 새 경로에도 걸린다', async () => {
    const c = client()
    server.failNext(1, { status: 502, match: `GRAPHQL ${OPERATIONS.contributions}` })
    await expect(collectContributions({ client: c })).rejects.toMatchObject({ status: 502 })
    expect((await collectContributions({ client: c })).totalCommitContributions).toBe(842)

    server.setRateLimited()
    await expect(collectRecentCommits({ client: c, login: V })).rejects.toBeInstanceOf(
      RateLimitedError
    )
    server.setRateLimited(null)

    server.setUnauthorized(true)
    await expect(collectMentionedIssues({ client: c })).rejects.toBeInstanceOf(SessionExpiredError)
    server.setUnauthorized(false)

    // 세션 만료는 클라이언트에 남으므로 새 클라이언트로
    const fresh = client()
    await fresh.get('/user')
    server.goOffline()
    await expect(
      collectIssueDetail({ ...DEMO, number: 45 }, { client: fresh })
    ).rejects.toBeInstanceOf(OfflineError)
    server.goOnline()
  })
})
