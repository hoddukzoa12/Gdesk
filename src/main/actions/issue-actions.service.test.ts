import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { IssueDetail } from '@shared/domain/issue-detail'
import type { SessionState } from '@shared/domain/session'
import { openDatabase } from '../db/connection'
import {
  getIssueDetail,
  getIssueTabCounts,
  listMyIssues,
  replaceIssues,
  replaceMyRepositories,
  saveIssueDetail,
  upsertRepositories
} from '../cache'
import { issueDetailRecord, issueRecord, repoRecord } from '../cache/test-fixtures'
import type { GitHubClient } from '../github/client'
import { createGitHubClientForTests } from '../github/client/testing'
import { OPERATIONS } from '../github/collectors/queries'
import {
  createIssueActionsService,
  parseCommentRequest,
  parseCreateIssueRequest,
  parseReactRequest,
  parseSetStateRequest,
  type IssueActionsClient,
  type IssueActionsService
} from './issue-actions.service'

const TOKEN = 'ghp_IssueActionsSecretToken1234567890ab'
const NOW = Date.UTC(2026, 9, 16, 12)
const REF = { repoId: 1, number: 5 }
const DETAIL_KEYS = ['issues', 'home', 'issue:1#5']

interface Call {
  method: string
  /** GraphQL 은 operationName, REST 는 "METHOD /path" */
  key: string
  url: URL
  body: unknown
  variables?: Record<string, unknown>
  query?: string
}

type Responder = (call: Call) => Response | Promise<Response>

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html;charset=utf-8' } })
}

function fakeClient(responder: Responder): { client: GitHubClient; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    let call: Call
    if (url.pathname === '/graphql') {
      const gql = body as {
        operationName: string
        variables: Record<string, unknown>
        query: string
      }
      call = {
        method,
        key: gql.operationName,
        url,
        body,
        variables: gql.variables,
        query: gql.query
      }
    } else {
      call = { method, key: `${method} ${url.pathname}`, url, body }
    }
    calls.push(call)
    return responder(call)
  })
  const client = createGitHubClientForTests({
    tokenProvider: () => TOKEN,
    fetch: fetchFn as unknown as typeof fetch,
    baseUrl: 'https://api.test'
  })
  return { client, calls }
}

function deferred(): { promise: Promise<Response>; resolve: (res: Response) => void } {
  let resolve!: (res: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const ok = (data: unknown = {}) => json({ data })

function commentNode(id: string, body = '<p>hi</p>') {
  return {
    id,
    createdAt: '2026-10-16T12:00:00Z',
    bodyHTML: body,
    author: { __typename: 'User', login: 'me', avatarUrl: 'https://avatars/me' },
    reactionGroups: []
  }
}

function createdIssueResponse(patch: Record<string, unknown> = {}) {
  return {
    id: 9001,
    node_id: 'I_new',
    number: 42,
    title: 'New bug',
    html_url: 'https://github.com/me/repo1/issues/42',
    user: { login: 'me', avatar_url: 'https://avatars/me', type: 'User' },
    labels: [{ name: 'bug', color: 'd73a4a', description: null }],
    assignees: [{ login: 'me', avatar_url: 'https://avatars/me', type: 'User' }],
    comments: 0,
    author_association: 'OWNER',
    created_at: '2026-10-16T12:00:00Z',
    updated_at: '2026-10-16T12:00:00Z',
    ...patch
  }
}

describe('이슈 쓰기 동작 서비스', () => {
  let db: DatabaseSync
  let session: SessionState
  let notify: ReturnType<typeof vi.fn<(keys: string[]) => void>>
  let refreshIssueLists: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  let current: boolean

  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(db, [
      repoRecord(1),
      repoRecord(2, { fork: true }),
      repoRecord(3, { archived: true }),
      repoRecord(4, { hasIssuesEnabled: false })
    ])
    // 내 저장소가 아닌 캐시 저장소(스타 등)
    upsertRepositories(db, [repoRecord(7, { owner: 'other', name: 'lib' })])
    saveIssueDetail(
      db,
      issueDetailRecord(1, 5, {
        reactions: [
          { content: 'THUMBS_UP', count: 2, viewerHasReacted: false },
          { content: 'HEART', count: 1, viewerHasReacted: true }
        ],
        comments: [
          {
            id: 'IC_1',
            author: { login: 'someone', avatarUrl: null, isBot: false },
            createdAt: '2026-10-02T00:00:00Z',
            bodyHTML: '<p>first</p>',
            reactions: [{ content: 'EYES', count: 1, viewerHasReacted: false }]
          }
        ],
        commentCount: 1
      }),
      NOW
    )
    session = 'signed_in'
    notify = vi.fn<(keys: string[]) => void>()
    refreshIssueLists = vi.fn<() => Promise<unknown>>(async () => undefined)
    current = true
  })

  afterEach(() => db.close())

  function make(client: IssueActionsClient): IssueActionsService {
    return createIssueActionsService({
      db: () => db,
      client,
      getSession: () => ({ state: session }),
      notify,
      refreshIssueLists,
      dataGuard: () => () => current,
      now: () => NOW
    })
  }

  function createdRecords(): { issue_id: string; created_at: number }[] {
    return db.prepare('SELECT issue_id, created_at FROM cache_created_issues').all() as {
      issue_id: string
      created_at: number
    }[]
  }

  function detail(): IssueDetail | null {
    return getIssueDetail(db, 1, 5)
  }

  describe('반응', () => {
    it('추가: 캐시(수 +1, viewerHasReacted)를 먼저 바꾸고 알린 뒤 GdeskAddReaction 을 보낸다', async () => {
      let during: IssueDetail | null = null
      const { client, calls } = fakeClient(() => {
        during = detail()
        expect(notify).toHaveBeenCalledTimes(1)
        return ok({ addReaction: { reaction: { content: 'THUMBS_UP' } } })
      })
      const result = await make(client).react({
        subjectId: 'I_1_5',
        issueRef: REF,
        content: 'THUMBS_UP',
        add: true
      })
      expect(result).toEqual({ ok: true })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        method: 'POST',
        key: OPERATIONS.addReaction,
        variables: { subjectId: 'I_1_5', content: 'THUMBS_UP' }
      })
      expect(calls[0]?.query).toContain('addReaction(input:')
      expect(during!.reactions).toContainEqual({
        content: 'THUMBS_UP',
        count: 3,
        viewerHasReacted: true
      })
      expect(detail()?.reactions).toContainEqual({
        content: 'THUMBS_UP',
        count: 3,
        viewerHasReacted: true
      })
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(DETAIL_KEYS))
    })

    it('취소: GdeskRemoveReaction, 수 -1', async () => {
      const { client, calls } = fakeClient(() => ok({ removeReaction: { reaction: null } }))
      const result = await make(client).react({
        subjectId: 'I_1_5',
        issueRef: REF,
        content: 'HEART',
        add: false
      })
      expect(result).toEqual({ ok: true })
      expect(calls.map((c) => c.key)).toEqual([OPERATIONS.removeReaction])
      expect(calls[0]?.query).toContain('removeReaction(input:')
      expect(detail()?.reactions).toContainEqual({
        content: 'HEART',
        count: 0,
        viewerHasReacted: false
      })
    })

    it('코멘트에 반응: 그 코멘트의 그룹만 바꾸고 없는 종류는 새 그룹으로 더한다', async () => {
      const { client, calls } = fakeClient(() => ok({ addReaction: {} }))
      await make(client).react({ subjectId: 'IC_1', issueRef: REF, content: 'ROCKET', add: true })
      expect(calls[0]?.variables).toEqual({ subjectId: 'IC_1', content: 'ROCKET' })
      const comment = detail()?.comments[0]
      expect(comment?.reactions).toEqual([
        { content: 'EYES', count: 1, viewerHasReacted: false },
        { content: 'ROCKET', count: 1, viewerHasReacted: true }
      ])
      // 이슈 반응은 그대로
      expect(detail()?.reactions).toEqual([
        { content: 'THUMBS_UP', count: 2, viewerHasReacted: false },
        { content: 'HEART', count: 1, viewerHasReacted: true }
      ])
    })

    it('실패하면 이전 상세로 정확히 되돌리고 failed(토큰 없는 문구)', async () => {
      const raw = () =>
        db.prepare('SELECT data, fetched_at FROM cache_issue_details WHERE repo_id = 1').get() as {
          data: string
          fetched_at: number
        }
      const before = raw()
      const { client } = fakeClient(() => json({ message: `boom ${TOKEN}` }, 502))
      const result = await make(client).react({
        subjectId: 'I_1_5',
        issueRef: REF,
        content: 'THUMBS_UP',
        add: true
      })
      expect(result).toMatchObject({ ok: false, reason: 'failed' })
      expect(JSON.stringify(result)).not.toContain(TOKEN)
      expect(raw()).toEqual(before)
      expect(notify).toHaveBeenCalledTimes(2)
    })

    it('GraphQL 오류(데이터 없음)도 실패로 되돌린다', async () => {
      const before = detail()
      const { client } = fakeClient(() =>
        json({ data: null, errors: [{ type: 'FORBIDDEN', message: 'nope' }] })
      )
      const result = await make(client).react({
        subjectId: 'I_1_5',
        issueRef: REF,
        content: 'LAUGH',
        add: true
      })
      expect(result).toMatchObject({ ok: false, reason: 'failed' })
      expect(detail()).toEqual(before)
    })

    it('viewerCanReact 가 false 면 not_allowed(요청·캐시 변경 없음)', async () => {
      saveIssueDetail(db, issueDetailRecord(1, 5, { viewerCanReact: false }), NOW)
      const before = detail()
      const { client, calls } = fakeClient(() => ok())
      const result = await make(client).react({
        subjectId: 'I_1_5',
        issueRef: REF,
        content: 'THUMBS_UP',
        add: true
      })
      expect(result).toEqual({ ok: false, reason: 'not_allowed' })
      expect(calls).toEqual([])
      expect(notify).not.toHaveBeenCalled()
      expect(detail()).toEqual(before)
    })

    it('캐시에 없는 이슈·대상은 not_cached(요청 없음)', async () => {
      const { client, calls } = fakeClient(() => ok())
      const s = make(client)
      expect(
        await s.react({
          subjectId: 'I_1_6',
          issueRef: { repoId: 1, number: 6 },
          content: 'EYES',
          add: true
        })
      ).toEqual({ ok: false, reason: 'not_cached' })
      expect(
        await s.react({ subjectId: 'IC_unknown', issueRef: REF, content: 'EYES', add: true })
      ).toEqual({ ok: false, reason: 'not_cached' })
      expect(calls).toEqual([])
    })
  })

  describe('코멘트', () => {
    it('GdeskAddComment(subjectId = 이슈 노드 ID) 성공: 새 코멘트를 붙이고 수를 늘리고 알린다', async () => {
      const { client, calls } = fakeClient(() =>
        ok({ addComment: { commentEdge: { node: commentNode('IC_2', '<p>hello</p>') } } })
      )
      const result = await make(client).comment({ issueRef: REF, body: 'hello' })
      expect(result).toEqual({ ok: true })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        key: OPERATIONS.addComment,
        variables: { subjectId: 'I_1_5', body: 'hello' }
      })
      expect(calls[0]?.query).toContain('addComment(input:')
      const d = detail()
      expect(d?.commentCount).toBe(2)
      expect(d?.comments.map((c) => c.id)).toEqual(['IC_1', 'IC_2'])
      expect(d?.comments[1]).toMatchObject({
        bodyHTML: '<p>hello</p>',
        author: { login: 'me', avatarUrl: 'https://avatars/me', isBot: false }
      })
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(DETAIL_KEYS))
    })

    it('받은 코멘트가 일부뿐이면 붙이지 않고 수만 늘린다', async () => {
      saveIssueDetail(db, issueDetailRecord(1, 5, { comments: [], commentCount: 150 }), NOW)
      const { client } = fakeClient(() =>
        ok({ addComment: { commentEdge: { node: commentNode('IC_9') } } })
      )
      expect(await make(client).comment({ issueRef: REF, body: 'x' })).toEqual({ ok: true })
      expect(detail()?.comments).toEqual([])
      expect(detail()?.commentCount).toBe(151)
    })

    it('빈 본문·공백뿐인 본문은 empty_body(요청 없음)', async () => {
      const { client, calls } = fakeClient(() => ok())
      const s = make(client)
      expect(await s.comment({ issueRef: REF, body: '' })).toEqual({
        ok: false,
        reason: 'empty_body'
      })
      expect(await s.comment({ issueRef: REF, body: ' \n\t ' })).toEqual({
        ok: false,
        reason: 'empty_body'
      })
      expect(calls).toEqual([])
      expect(notify).not.toHaveBeenCalled()
    })

    it('viewerCanComment 가 false(잠긴 이슈 + 쓰기 권한 없음)면 not_allowed', async () => {
      saveIssueDetail(db, issueDetailRecord(1, 5, { locked: true, viewerPermission: 'READ' }), NOW)
      const before = detail()
      const { client, calls } = fakeClient(() => ok())
      expect(await make(client).comment({ issueRef: REF, body: 'hi' })).toEqual({
        ok: false,
        reason: 'not_allowed'
      })
      expect(calls).toEqual([])
      expect(detail()).toEqual(before)
    })

    it('실패하면 failed, 캐시는 그대로', async () => {
      const before = detail()
      const { client } = fakeClient(() => json({ message: 'nope' }, 500))
      expect(await make(client).comment({ issueRef: REF, body: 'hi' })).toMatchObject({
        ok: false,
        reason: 'failed'
      })
      expect(detail()).toEqual(before)
      expect(notify).not.toHaveBeenCalled()
    })

    it('요청 중 로그아웃·계정 전환으로 데이터 세대가 바뀌면 성공해도 캐시에 쓰지 않는다', async () => {
      const before = detail()
      const { client } = fakeClient(() => {
        current = false
        return ok({ addComment: { commentEdge: { node: commentNode('IC_2') } } })
      })
      expect(await make(client).comment({ issueRef: REF, body: 'hi' })).toEqual({ ok: true })
      expect(detail()).toEqual(before)
    })
  })

  describe('닫기·다시 열기', () => {
    it('닫기(not_planned): 상태를 먼저 바꾸고 GdeskCloseIssue(NOT_PLANNED), 성공하면 목록을 새로 받게 한다', async () => {
      let during: IssueDetail | null = null
      const { client, calls } = fakeClient(() => {
        during = detail()
        return ok({ closeIssue: { issue: { id: 'I_1_5', state: 'CLOSED' } } })
      })
      const result = await make(client).setState({
        issueRef: REF,
        state: 'closed',
        reason: 'not_planned'
      })
      expect(result).toEqual({ ok: true })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        key: OPERATIONS.closeIssue,
        variables: { issueId: 'I_1_5', stateReason: 'NOT_PLANNED' }
      })
      expect(calls[0]?.query).toContain('closeIssue(input:')
      expect(during).toMatchObject({ state: 'closed', stateReason: 'not_planned' })
      expect(detail()).toMatchObject({ state: 'closed', stateReason: 'not_planned' })
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(DETAIL_KEYS))
      expect(refreshIssueLists).toHaveBeenCalledTimes(1)
    })

    it('닫기 이유가 없으면 COMPLETED', async () => {
      const { client, calls } = fakeClient(() => ok({ closeIssue: {} }))
      await make(client).setState({ issueRef: REF, state: 'closed' })
      expect(calls[0]?.variables).toEqual({ issueId: 'I_1_5', stateReason: 'COMPLETED' })
      expect(detail()).toMatchObject({ state: 'closed', stateReason: 'completed' })
    })

    it('다시 열기: GdeskReopenIssue, 상태 open·이유 null', async () => {
      saveIssueDetail(
        db,
        issueDetailRecord(1, 5, {
          state: 'closed',
          stateReason: 'completed',
          viewerCanClose: true,
          viewerCanReopen: true
        }),
        NOW
      )
      const { client, calls } = fakeClient(() => ok({ reopenIssue: {} }))
      expect(await make(client).setState({ issueRef: REF, state: 'open' })).toEqual({ ok: true })
      expect(calls[0]).toMatchObject({
        key: OPERATIONS.reopenIssue,
        variables: { issueId: 'I_1_5' }
      })
      expect(calls[0]?.query).toContain('reopenIssue(input:')
      expect(detail()).toMatchObject({ state: 'open', stateReason: null })
      expect(refreshIssueLists).toHaveBeenCalledTimes(1)
    })

    it('실패하면 상태를 정확히 되돌리고 목록을 새로 받지 않는다', async () => {
      const raw = () =>
        db.prepare('SELECT data, fetched_at FROM cache_issue_details WHERE repo_id = 1').get() as {
          data: string
          fetched_at: number
        }
      const before = raw()
      const { client } = fakeClient(() => json({ message: 'x' }, 500))
      expect(await make(client).setState({ issueRef: REF, state: 'closed' })).toMatchObject({
        ok: false,
        reason: 'failed'
      })
      expect(raw()).toEqual(before)
      expect(notify).toHaveBeenCalledTimes(2)
      expect(refreshIssueLists).not.toHaveBeenCalled()
    })

    it('viewerCanClose·viewerCanReopen 이 false 면 not_allowed', async () => {
      saveIssueDetail(db, issueDetailRecord(1, 5, { viewerCanClose: false }), NOW)
      const { client, calls } = fakeClient(() => ok())
      const s = make(client)
      expect(await s.setState({ issueRef: REF, state: 'closed' })).toEqual({
        ok: false,
        reason: 'not_allowed'
      })
      saveIssueDetail(db, issueDetailRecord(1, 5, { state: 'closed', viewerCanReopen: false }), NOW)
      const before = detail()
      expect(await s.setState({ issueRef: REF, state: 'open' })).toEqual({
        ok: false,
        reason: 'not_allowed'
      })
      expect(calls).toEqual([])
      expect(notify).not.toHaveBeenCalled()
      expect(detail()).toEqual(before)
    })

    it('목록 새로 받기가 실패해도 결과는 성공', async () => {
      refreshIssueLists.mockRejectedValueOnce(new Error('offline'))
      const { client } = fakeClient(() => ok({ closeIssue: {} }))
      expect(await make(client).setState({ issueRef: REF, state: 'closed' })).toEqual({
        ok: true
      })
    })
  })

  describe('새 이슈', () => {
    it('POST /repos/{o}/{r}/issues 성공: 결과를 돌려주고 "내 이슈" 캐시에 바로 넣고 알린다', async () => {
      replaceIssues(db, 'mine', [issueRecord('I_old', 1, { viewerIsAuthor: true })], {
        totalCount: 1
      })
      const { client, calls } = fakeClient(() => json(createdIssueResponse(), 201))
      const result = await make(client).create({
        repoId: 1,
        title: '  New bug  ',
        body: 'Steps',
        labels: ['bug'],
        assignees: ['me']
      })
      expect(result).toEqual({ ok: true, issue: { repoId: 1, number: 42, nodeId: 'I_new' } })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        method: 'POST',
        key: 'POST /repos/me/repo1/issues',
        body: { title: 'New bug', body: 'Steps', labels: ['bug'], assignees: ['me'] }
      })
      const mine = listMyIssues(db)
      expect(mine.items.map((i) => i.id)).toEqual(['I_new', 'I_old'])
      expect(mine.items[0]).toMatchObject({
        repoId: 1,
        repoFullName: 'me/repo1',
        number: 42,
        title: 'New bug',
        url: 'https://github.com/me/repo1/issues/42',
        author: { login: 'me', avatarUrl: 'https://avatars/me', isBot: false },
        labels: [{ name: 'bug', color: 'd73a4a' }],
        assignees: [{ login: 'me', avatarUrl: 'https://avatars/me', isBot: false }],
        commentCount: 0
      })
      expect(mine.totalCount).toBe(2)
      expect(getIssueTabCounts(db).mine).toBe(2)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['issues', 'home']))
    })

    it('본문·라벨·담당자가 비면 보내지 않는다', async () => {
      const { client, calls } = fakeClient(() => json(createdIssueResponse(), 201))
      await make(client).create({ repoId: 1, title: 'T', body: '', labels: [], assignees: [] })
      expect(calls[0]?.body).toEqual({ title: 'T' })
    })

    it('빈 제목·공백뿐인 제목은 empty_title(요청 없음)', async () => {
      const { client, calls } = fakeClient(() => json(createdIssueResponse(), 201))
      expect(await make(client).create({ repoId: 1, title: '   ' })).toEqual({
        ok: false,
        reason: 'empty_title'
      })
      expect(calls).toEqual([])
    })

    it.each([
      [2, 'repo_fork'],
      [3, 'repo_archived'],
      [4, 'repo_issues_disabled'],
      [7, 'repo_not_mine'],
      [999, 'repo_not_mine']
    ])('저장소 %i → %s(요청·캐시 변경 없음)', async (repoId, reason) => {
      const { client, calls } = fakeClient(() => json(createdIssueResponse(), 201))
      expect(await make(client).create({ repoId, title: 'T' })).toEqual({ ok: false, reason })
      expect(calls).toEqual([])
      expect(listMyIssues(db).items).toEqual([])
      expect(notify).not.toHaveBeenCalled()
    })

    it('실패하면 failed, 캐시는 그대로', async () => {
      const { client } = fakeClient(() => json({ message: 'Validation Failed' }, 422))
      expect(await make(client).create({ repoId: 1, title: 'T' })).toMatchObject({
        ok: false,
        reason: 'failed',
        message: 'Validation Failed'
      })
      expect(listMyIssues(db).items).toEqual([])
      expect(notify).not.toHaveBeenCalled()
    })

    it('요청 중 데이터 세대가 바뀌면 만든 이슈를 캐시에 넣지 않는다', async () => {
      const { client } = fakeClient(() => {
        current = false
        return json(createdIssueResponse(), 201)
      })
      expect(await make(client).create({ repoId: 1, title: 'T' })).toMatchObject({ ok: true })
      expect(listMyIssues(db).items).toEqual([])
      expect(createdRecords()).toEqual([])
    })

    it('만든 이슈를 만든 시각과 함께 기록한다(검색 반영 전 목록 갱신에서 남기려고)', async () => {
      const { client } = fakeClient(() => json(createdIssueResponse(), 201))
      await make(client).create({ repoId: 1, title: 'T' })
      expect(createdRecords()).toEqual([{ issue_id: 'I_new', created_at: NOW }])
    })

    it('만든 이슈를 닫으면 기록을 지운다(닫힌 이슈를 유예로 남기지 않게)', async () => {
      const { client } = fakeClient((call) =>
        call.key === OPERATIONS.closeIssue
          ? ok({ closeIssue: {} })
          : json(createdIssueResponse(), 201)
      )
      const s = make(client)
      await s.create({ repoId: 1, title: 'T' })
      saveIssueDetail(db, issueDetailRecord(1, 42, { id: 'I_new' }), NOW)
      expect(await s.setState({ issueRef: { repoId: 1, number: 42 }, state: 'closed' })).toEqual({
        ok: true
      })
      expect(createdRecords()).toEqual([])
    })
  })

  describe('라벨·담당자 선택지', () => {
    it('GET labels·assignees(per_page=100) 를 페이지 상한까지 받아 돌려준다', async () => {
      const { client, calls } = fakeClient((call) => {
        if (call.key === 'GET /repos/me/repo1/labels') {
          const page = call.url.searchParams.get('page') ?? '1'
          return page === '1'
            ? json([{ name: 'bug', color: 'd73a4a', description: 'Broken' }], 200, {
                link: '<https://api.test/repos/me/repo1/labels?per_page=100&page=2>; rel="next"'
              })
            : json([{ name: 'docs', color: '0075ca', description: null }])
        }
        return json([{ login: 'me', avatar_url: 'https://avatars/me' }])
      })
      const result = await make(client).repoMeta(1)
      expect(result).toEqual({
        ok: true,
        labels: [
          { name: 'bug', color: 'd73a4a', description: 'Broken' },
          { name: 'docs', color: '0075ca', description: null }
        ],
        assignees: [{ login: 'me', avatarUrl: 'https://avatars/me' }]
      })
      expect(calls.map((c) => c.key)).toEqual([
        'GET /repos/me/repo1/labels',
        'GET /repos/me/repo1/labels',
        'GET /repos/me/repo1/assignees'
      ])
      expect(calls[0]?.url.searchParams.get('per_page')).toBe('100')
      expect(calls[2]?.url.searchParams.get('per_page')).toBe('100')
      expect(notify).not.toHaveBeenCalled()
    })

    it('페이지 상한에서 멈춘다', async () => {
      const { client, calls } = fakeClient((call) =>
        json([{ name: `l${calls.length}`, color: null, description: null }], 200, {
          link: `<https://api.test${call.url.pathname}?page=${calls.length + 1}>; rel="next"`
        })
      )
      const s = createIssueActionsService({
        db: () => db,
        client,
        getSession: () => ({ state: session }),
        notify,
        repoMetaMaxPages: 2
      })
      const result = await s.repoMeta(1)
      expect(result.ok).toBe(true)
      expect(calls).toHaveLength(4)
    })

    it('새 이슈를 만들 수 없는 저장소는 거절, 실패는 failed', async () => {
      const { client, calls } = fakeClient(() => json({ message: 'x' }, 500))
      const s = make(client)
      expect(await s.repoMeta(2)).toEqual({ ok: false, reason: 'repo_fork' })
      expect(calls).toEqual([])
      expect(await s.repoMeta(1)).toMatchObject({ ok: false, reason: 'failed' })
    })
  })

  describe('마크다운 미리보기', () => {
    it('POST /markdown { text, mode: gfm, context } 의 text/html 을 그대로 돌려준다', async () => {
      const { client, calls } = fakeClient(() => html('<p>Hello <strong>world</strong></p>\n'))
      const result = await make(client).previewMarkdown(1, 'Hello **world**')
      expect(result).toEqual({ ok: true, html: '<p>Hello <strong>world</strong></p>\n' })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        method: 'POST',
        key: 'POST /markdown',
        body: { text: 'Hello **world**', mode: 'gfm', context: 'me/repo1' }
      })
    })

    it('JSON 처럼 보이는 HTML 도 문자열로 돌려준다', async () => {
      const { client } = fakeClient(() => html('42'))
      expect(await make(client).previewMarkdown(1, '42')).toEqual({ ok: true, html: '42' })
    })

    it('캐시에 없는 저장소면 context 없이 보낸다', async () => {
      const { client, calls } = fakeClient(() => html('<p>x</p>'))
      await make(client).previewMarkdown(999, 'x')
      expect(calls[0]?.body).toEqual({ text: 'x', mode: 'gfm' })
    })

    it('빈 글은 요청 없이 빈 HTML', async () => {
      const { client, calls } = fakeClient(() => html('<p>x</p>'))
      expect(await make(client).previewMarkdown(1, '  ')).toEqual({ ok: true, html: '' })
      expect(calls).toEqual([])
    })

    it('실패는 failed', async () => {
      const { client } = fakeClient(() => json({ message: 'x' }, 500))
      expect(await make(client).previewMarkdown(1, 'x')).toMatchObject({
        ok: false,
        reason: 'failed'
      })
    })
  })

  describe('막힘(요청도 캐시 변경도 없음)', () => {
    const cases: [string, ConnectionStatus, SessionState, string][] = [
      ['오프라인', 'offline', 'signed_in', 'offline'],
      ['요청 한도', 'rate_limited', 'signed_in', 'rate_limited'],
      ['클라이언트 세션 만료', 'session_expired', 'signed_in', 'session_expired'],
      ['인증 세션 만료', 'online', 'expired', 'session_expired'],
      ['로그아웃', 'online', 'signed_out', 'signed_out'],
      ['로그인 중', 'online', 'signing_in', 'signed_out'],
      ['세션 만료가 오프라인보다 먼저', 'offline', 'expired', 'session_expired']
    ]

    it.each(cases)('%s', async (_name, status, state, reason) => {
      const { client, calls } = fakeClient(() => ok())
      vi.spyOn(client, 'getStatus').mockReturnValue(status)
      session = state
      replaceIssues(db, 'mine', [issueRecord('I_old', 1, { viewerIsAuthor: true })])
      const detailBefore = detail()
      const mineBefore = listMyIssues(db)
      const s = make(client)
      const blocked = { ok: false, reason }
      expect(
        await s.react({ subjectId: 'I_1_5', issueRef: REF, content: 'EYES', add: true })
      ).toEqual(blocked)
      expect(await s.comment({ issueRef: REF, body: 'hi' })).toEqual(blocked)
      expect(await s.setState({ issueRef: REF, state: 'closed' })).toEqual(blocked)
      expect(await s.create({ repoId: 1, title: 'T' })).toEqual(blocked)
      expect(await s.repoMeta(1)).toEqual(blocked)
      expect(await s.previewMarkdown(1, 'x')).toEqual(blocked)
      expect(calls).toEqual([])
      expect(notify).not.toHaveBeenCalled()
      expect(refreshIssueLists).not.toHaveBeenCalled()
      expect(detail()).toEqual(detailBefore)
      expect(listMyIssues(db)).toEqual(mineBefore)
    })

    it('세션을 읽을 수 없으면 signed_out', async () => {
      const { client, calls } = fakeClient(() => ok())
      const s = createIssueActionsService({
        db: () => db,
        client,
        getSession: () => {
          throw new Error('auth not ready')
        },
        notify
      })
      expect(await s.setState({ issueRef: REF, state: 'closed' })).toEqual({
        ok: false,
        reason: 'signed_out'
      })
      expect(calls).toEqual([])
    })
  })

  describe('같은 이슈 연속 동작', () => {
    it('같은 이슈의 동작은 앞 동작이 끝난 뒤 차례로 처리된다(반응 → 닫기)', async () => {
      const first = deferred()
      const { client, calls } = fakeClient((call) =>
        call.key === OPERATIONS.addReaction ? first.promise : ok({ closeIssue: {} })
      )
      const s = make(client)
      const a = s.react({ subjectId: 'I_1_5', issueRef: REF, content: 'EYES', add: true })
      const b = s.setState({ issueRef: REF, state: 'closed' })
      await vi.waitFor(() => expect(calls).toHaveLength(1))
      await new Promise((r) => setTimeout(r, 10))
      // 첫 요청이 끝나기 전에는 두 번째 동작이 요청도 캐시 변경도 하지 않는다
      expect(calls).toHaveLength(1)
      expect(detail()?.state).toBe('open')
      first.resolve(json({ message: 'x' }, 500))
      expect(await a).toMatchObject({ ok: false, reason: 'failed' })
      expect(await b).toEqual({ ok: true })
      expect(calls.map((c) => c.key)).toEqual([OPERATIONS.addReaction, OPERATIONS.closeIssue])
      // 반응은 되돌려지고 닫기만 남는다
      expect(detail()?.reactions).toEqual([
        { content: 'THUMBS_UP', count: 2, viewerHasReacted: false },
        { content: 'HEART', count: 1, viewerHasReacted: true }
      ])
      expect(detail()?.state).toBe('closed')
    })

    it('앞 동작 뒤에 막힘을 다시 판단한다(네트워크 실패로 오프라인 → 뒤 동작은 offline)', async () => {
      const { client, calls } = fakeClient(() => {
        throw new TypeError('fetch failed')
      })
      const s = make(client)
      const a = s.setState({ issueRef: REF, state: 'closed' })
      const b = s.comment({ issueRef: REF, body: 'hi' })
      expect(await a).toMatchObject({ ok: false, reason: 'failed' })
      expect(await b).toEqual({ ok: false, reason: 'offline' })
      expect(calls).toHaveLength(1)
      expect(detail()?.state).toBe('open')
    })

    it('다른 이슈끼리는 기다리지 않는다', async () => {
      saveIssueDetail(db, issueDetailRecord(1, 6), NOW)
      const first = deferred()
      const { client, calls } = fakeClient((call) =>
        call.variables?.issueId === 'I_1_5' ? first.promise : ok({ closeIssue: {} })
      )
      const s = make(client)
      const a = s.setState({ issueRef: REF, state: 'closed' })
      const b = s.setState({ issueRef: { repoId: 1, number: 6 }, state: 'closed' })
      expect(await b).toEqual({ ok: true })
      expect(calls).toHaveLength(2)
      first.resolve(ok({ closeIssue: {} }))
      expect(await a).toEqual({ ok: true })
    })
  })
})

describe('요청 값 검사(잘못된 요청은 던진다)', () => {
  it('반응', () => {
    const good = { subjectId: 'I_1', issueRef: REF, content: 'HEART', add: true }
    expect(parseReactRequest(good)).toEqual(good)
    expect(() => parseReactRequest({ ...good, content: 'SMILE' })).toThrow()
    expect(() => parseReactRequest({ ...good, add: 'yes' })).toThrow()
    expect(() => parseReactRequest({ ...good, subjectId: '' })).toThrow()
    expect(() => parseReactRequest({ ...good, issueRef: { repoId: 0, number: 1 } })).toThrow()
    expect(() => parseReactRequest(null)).toThrow()
  })

  it('코멘트', () => {
    expect(parseCommentRequest({ issueRef: REF, body: '' })).toEqual({ issueRef: REF, body: '' })
    expect(() => parseCommentRequest({ issueRef: REF, body: 3 })).toThrow()
    expect(() => parseCommentRequest({ issueRef: { repoId: 1 }, body: 'x' })).toThrow()
  })

  it('상태', () => {
    expect(parseSetStateRequest({ issueRef: REF, state: 'closed', reason: 'not_planned' })).toEqual(
      { issueRef: REF, state: 'closed', reason: 'not_planned' }
    )
    expect(parseSetStateRequest({ issueRef: REF, state: 'open', reason: 'completed' })).toEqual({
      issueRef: REF,
      state: 'open'
    })
    expect(() => parseSetStateRequest({ issueRef: REF, state: 'merged' })).toThrow()
    expect(() =>
      parseSetStateRequest({ issueRef: REF, state: 'closed', reason: 'duplicate' })
    ).toThrow()
  })

  it('새 이슈', () => {
    expect(
      parseCreateIssueRequest({
        repoId: 1,
        title: 'T',
        labels: ['bug', 'bug', ' docs '],
        assignees: ['me']
      })
    ).toEqual({ repoId: 1, title: 'T', body: '', labels: ['bug', 'docs'], assignees: ['me'] })
    expect(() => parseCreateIssueRequest({ repoId: -1, title: 'T' })).toThrow()
    expect(() => parseCreateIssueRequest({ repoId: 1, title: 5 })).toThrow()
    expect(() => parseCreateIssueRequest({ repoId: 1, title: 'T', body: 1 })).toThrow()
    expect(() => parseCreateIssueRequest({ repoId: 1, title: 'T', labels: [1] })).toThrow()
    expect(() =>
      parseCreateIssueRequest({
        repoId: 1,
        title: 'T',
        assignees: Array.from({ length: 11 }, (_, i) => `u${i}`)
      })
    ).toThrow()
  })
})
