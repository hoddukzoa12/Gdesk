import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '../../cache/cleaner'
import { getIssueDetail, saveIssueDetail } from '../../cache/issue-details'
import { replaceIssues } from '../../cache/issues'
import { replaceMyRepositories } from '../../cache/repositories'
import { issueRecord, repoRecord } from '../../cache/test-fixtures'
import { clearFetchedData, currentDataGuard, registerFetchedDataCleaner } from '../../db/cleanup'
import { openDatabase } from '../../db/connection'
import { StaleRefreshError } from './common'
import { collectIssueDetail } from './issue-detail'
import { OPERATIONS } from './queries'
import { refreshIssueDetail } from './refresh'
import { fakeGitHub, json } from './test-server'

const NOW = Date.UTC(2026, 9, 16, 12)

function pr(number: number, state: string, repo = 'me/repo1'): Record<string, unknown> {
  return {
    __typename: 'PullRequest',
    number,
    title: `PR ${number}`,
    state,
    url: `https://github.com/${repo}/pull/${number}`,
    repository: { nameWithOwner: repo }
  }
}

const SELF_ISSUE = { __typename: 'Issue' }

function reactions(patch: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [
    { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 3 } },
    { content: 'HEART', viewerHasReacted: false, reactors: { totalCount: 0 } },
    { content: 'UNKNOWN_EMOJI', viewerHasReacted: false, reactors: { totalCount: 9 } },
    ...patch
  ]
}

function rawDetail(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'I_7',
    number: 7,
    url: 'https://github.com/me/repo1/issues/7',
    title: 'Crash on start',
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    locked: true,
    createdAt: '2026-10-01T00:00:00Z',
    bodyHTML: '<p>It crashes</p>',
    author: { __typename: 'User', login: 'alice', avatarUrl: 'https://avatars/alice' },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }, null, { name: null }] },
    assignees: {
      nodes: [{ __typename: 'User', login: 'bob', avatarUrl: 'https://avatars/bob' }, null]
    },
    reactionGroups: reactions(),
    viewerCanClose: false,
    viewerCanReopen: true,
    viewerCanReact: true,
    comments: {
      totalCount: 140,
      nodes: [
        {
          id: 'IC_1',
          createdAt: '2026-10-02T00:00:00Z',
          bodyHTML: '<p>first</p>',
          author: { __typename: 'Bot', login: 'ci-bot', avatarUrl: null },
          reactionGroups: [
            { content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 1 } }
          ]
        },
        {
          id: 'IC_2',
          createdAt: '2026-10-03T00:00:00Z',
          bodyHTML: '<p>second</p>',
          author: null,
          reactionGroups: null
        },
        { id: null, createdAt: '2026-10-04T00:00:00Z', bodyHTML: 'no id' }
      ]
    },
    closedByPullRequestsReferences: { nodes: [pr(10, 'MERGED')] },
    timelineItems: {
      nodes: [
        // 닫는 PR 과 같은 PR 의 교차 참조는 한 번만
        { __typename: 'CrossReferencedEvent', source: pr(10, 'MERGED') },
        // 이슈가 이슈를 참조한 것은 PR 이 아니다
        { __typename: 'CrossReferencedEvent', source: { __typename: 'Issue' } },
        { __typename: 'CrossReferencedEvent', source: pr(11, 'OPEN', 'other/lib') },
        { __typename: 'ConnectedEvent', source: SELF_ISSUE, subject: pr(12, 'CLOSED') },
        { __typename: 'ConnectedEvent', source: pr(13, 'OPEN'), subject: SELF_ISSUE },
        // 13 은 연결 해제됐다
        { __typename: 'DisconnectedEvent', source: pr(13, 'OPEN'), subject: SELF_ISSUE },
        {
          __typename: 'ReferencedEvent',
          commitRepository: { nameWithOwner: 'me/repo1' },
          commit: {
            oid: 'abc123',
            messageHeadline: 'Fix crash #7',
            committedDate: '2026-10-05T00:00:00Z',
            url: 'https://github.com/me/repo1/commit/abc123',
            author: {
              name: 'Me',
              user: { __typename: 'User', login: 'me', avatarUrl: 'https://avatars/me' }
            }
          }
        },
        // 같은 커밋은 한 번만, 사용자와 연결되지 않은 작성자
        {
          __typename: 'ReferencedEvent',
          commitRepository: { nameWithOwner: 'me/repo1' },
          commit: {
            oid: 'abc123',
            messageHeadline: 'Fix crash #7',
            committedDate: '2026-10-05T00:00:00Z',
            url: 'https://github.com/me/repo1/commit/abc123',
            author: { name: 'Me', user: null }
          }
        },
        {
          __typename: 'ReferencedEvent',
          commitRepository: { nameWithOwner: 'fork/repo1' },
          commit: {
            oid: 'def456',
            messageHeadline: 'Ref #7',
            committedDate: null,
            url: 'https://github.com/fork/repo1/commit/def456',
            author: { name: 'Anon', user: null }
          }
        },
        // 커밋이 없어진 참조
        { __typename: 'ReferencedEvent', commitRepository: null, commit: null }
      ]
    },
    ...patch
  }
}

function detailResponse(issue: unknown, permission = 'READ') {
  return () => ({
    data: {
      repository: {
        databaseId: 1,
        nameWithOwner: 'me/repo1',
        viewerPermission: permission,
        issue
      }
    }
  })
}

describe('collectIssueDetail', () => {
  it('상세를 매핑한다: 상태·라벨·담당자·반응·코멘트(노드 ID)·연결 PR·참조 커밋', async () => {
    const { client, calls } = fakeGitHub({
      graphql: { [OPERATIONS.issueDetail]: detailResponse(rawDetail()) }
    })
    const result = await collectIssueDetail(
      { repoId: 1, fullName: 'me/repo1', number: 7 },
      { client }
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const d = result.detail
    expect(calls[0]?.graphql?.variables).toMatchObject({
      owner: 'me',
      name: 'repo1',
      number: 7,
      commentCount: 100
    })
    // 긴 이슈에서도 최근 교차 참조·커밋이 남도록 타임라인은 끝에서부터 받는다
    expect(calls[0]?.graphql?.query).toMatch(/timelineItems\(\s*last: \$timelineCount/)
    expect(d).toMatchObject({
      id: 'I_7',
      repoId: 1,
      repoFullName: 'me/repo1',
      number: 7,
      title: 'Crash on start',
      state: 'closed',
      stateReason: 'not_planned',
      locked: true,
      bodyHTML: '<p>It crashes</p>',
      author: { login: 'alice', avatarUrl: 'https://avatars/alice', isBot: false },
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: [{ login: 'bob', avatarUrl: 'https://avatars/bob', isBot: false }],
      viewerCanClose: false,
      viewerCanReopen: true,
      viewerCanReact: true,
      viewerPermission: 'READ',
      commentCount: 140
    })
    // 모르는 반응 종류는 버리고, 0 명인 그룹도 viewerHasReacted 와 함께 남긴다
    expect(d.reactions).toEqual([
      { content: 'THUMBS_UP', count: 3, viewerHasReacted: true },
      { content: 'HEART', count: 0, viewerHasReacted: false }
    ])
    expect(d.comments).toEqual([
      {
        id: 'IC_1',
        author: { login: 'ci-bot', avatarUrl: null, isBot: true },
        createdAt: '2026-10-02T00:00:00Z',
        bodyHTML: '<p>first</p>',
        reactions: [{ content: 'EYES', count: 1, viewerHasReacted: false }]
      },
      {
        id: 'IC_2',
        author: { login: 'ghost', avatarUrl: null, isBot: false },
        createdAt: '2026-10-03T00:00:00Z',
        bodyHTML: '<p>second</p>',
        reactions: []
      }
    ])
    expect(d.linkedPullRequests).toEqual([
      {
        number: 10,
        title: 'PR 10',
        state: 'merged',
        repoFullName: 'me/repo1',
        url: 'https://github.com/me/repo1/pull/10'
      },
      {
        number: 11,
        title: 'PR 11',
        state: 'open',
        repoFullName: 'other/lib',
        url: 'https://github.com/other/lib/pull/11'
      },
      {
        number: 12,
        title: 'PR 12',
        state: 'closed',
        repoFullName: 'me/repo1',
        url: 'https://github.com/me/repo1/pull/12'
      }
    ])
    expect(d.referencingCommits).toEqual([
      {
        sha: 'abc123',
        message: 'Fix crash #7',
        author: { login: 'me', avatarUrl: 'https://avatars/me', isBot: false },
        authorName: 'Me',
        committedAt: '2026-10-05T00:00:00Z',
        url: 'https://github.com/me/repo1/commit/abc123',
        repoFullName: 'me/repo1'
      },
      {
        sha: 'def456',
        message: 'Ref #7',
        author: null,
        authorName: 'Anon',
        committedAt: null,
        url: 'https://github.com/fork/repo1/commit/def456',
        repoFullName: 'fork/repo1'
      }
    ])
  })

  it('상태 값: 열림·다시 열림은 이유 없음, DUPLICATE·COMPLETED, 모르는 값', async () => {
    const cases: [Record<string, unknown>, string, string | null][] = [
      [{ state: 'OPEN', stateReason: null }, 'open', null],
      [{ state: 'OPEN', stateReason: 'REOPENED' }, 'open', null],
      [{ state: 'CLOSED', stateReason: 'COMPLETED' }, 'closed', 'completed'],
      [{ state: 'CLOSED', stateReason: 'DUPLICATE' }, 'closed', 'duplicate'],
      [{ state: 'CLOSED', stateReason: 'SOMETHING_NEW' }, 'closed', null]
    ]
    for (const [patch, state, reason] of cases) {
      const { client } = fakeGitHub({
        graphql: { [OPERATIONS.issueDetail]: detailResponse(rawDetail(patch)) }
      })
      const result = await collectIssueDetail(
        { repoId: 1, fullName: 'me/repo1', number: 7 },
        { client }
      )
      expect(result.status === 'ok' && result.detail.state).toBe(state)
      expect(result.status === 'ok' && result.detail.stateReason).toBe(reason)
    }
  })

  it('이슈가 없거나(PR 번호·삭제) 저장소가 비어 오면 not_found', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.issueDetail]: (_vars, call) =>
          call === 1
            ? {
                data: { repository: { databaseId: 1, viewerPermission: 'ADMIN', issue: null } },
                errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an Issue' }]
              }
            : {
                data: { repository: null },
                errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }]
              }
      }
    })
    const target = { repoId: 1, fullName: 'me/repo1', number: 7 }
    expect((await collectIssueDetail(target, { client })).status).toBe('not_found')
    expect((await collectIssueDetail(target, { client })).status).toBe('not_found')
  })
})

describe('refreshIssueDetail', () => {
  let db: DatabaseSync
  let unregister: () => void
  beforeEach(() => {
    db = openDatabase(':memory:')
    unregister = registerFetchedDataCleaner(clearCache)
  })
  afterEach(() => {
    unregister()
    db.close()
  })

  it('캐시의 저장소 이름으로 받아 상세 캐시에 쓴다. 코멘트 가능 여부는 잠김·권한으로 계산', async () => {
    replaceMyRepositories(db, [repoRecord(1)])
    const { client, calls } = fakeGitHub({
      graphql: { [OPERATIONS.issueDetail]: detailResponse(rawDetail(), 'READ') }
    })
    const result = await refreshIssueDetail({ db, client, repoId: 1, number: 7, now: NOW })
    expect(result.status).toBe('ok')
    expect(calls[0]?.graphql?.variables).toMatchObject({ owner: 'me', name: 'repo1', number: 7 })
    const cached = getIssueDetail(db, 1, 7)
    expect(cached).toMatchObject({
      id: 'I_7',
      locked: true,
      viewerPermission: 'READ',
      viewerCanComment: false,
      fetchedAt: NOW
    })
    expect(cached?.comments.map((c) => c.id)).toEqual(['IC_1', 'IC_2'])
  })

  it('저장소 행이 없으면 캐시의 이슈 행에서 이름을 찾는다(언급·할당된 남의 저장소)', async () => {
    replaceIssues(db, 'mentioned', [
      issueRecord('I_x', 55, { repoFullName: 'other/lib', number: 7 })
    ])
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.issueDetail]: () => ({
          data: {
            repository: {
              databaseId: 55,
              nameWithOwner: 'other/lib',
              viewerPermission: 'WRITE',
              issue: rawDetail({ locked: true })
            }
          }
        })
      }
    })
    await refreshIssueDetail({ db, client, repoId: 55, number: 7, now: NOW })
    expect(calls[0]?.graphql?.variables).toMatchObject({ owner: 'other', name: 'lib' })
    expect(getIssueDetail(db, 55, 7)).toMatchObject({
      repoFullName: 'other/lib',
      viewerCanComment: true
    })
  })

  it('캐시 어디에도 이름이 없으면 GET /repositories/{id} 로 찾고, 접근할 수 없으면 not_found', async () => {
    const { client, calls } = fakeGitHub({
      rest: {
        'GET /repositories/77': () => json({ id: 77, full_name: 'far/away' }),
        'GET /repositories/78': () => json({ message: 'Not Found' }, 404)
      },
      graphql: { [OPERATIONS.issueDetail]: detailResponse(rawDetail()) }
    })
    expect((await refreshIssueDetail({ db, client, repoId: 77, number: 7, now: NOW })).status).toBe(
      'ok'
    )
    expect(calls.find((c) => c.graphql)?.graphql?.variables).toMatchObject({
      owner: 'far',
      name: 'away'
    })
    expect((await refreshIssueDetail({ db, client, repoId: 78, number: 7, now: NOW })).status).toBe(
      'not_found'
    )
    expect(getIssueDetail(db, 78, 7)).toBeNull()
  })

  it('not_found 면 이전에 받은 상세를 그대로 둔다', async () => {
    replaceMyRepositories(db, [repoRecord(1)])
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.issueDetail]: (_v, call) =>
          call === 1
            ? detailResponse(rawDetail())()
            : { data: { repository: { databaseId: 1, viewerPermission: 'ADMIN', issue: null } } }
      }
    })
    await refreshIssueDetail({ db, client, repoId: 1, number: 7, now: NOW })
    const result = await refreshIssueDetail({ db, client, repoId: 1, number: 7, now: NOW + 1 })
    expect(result.status).toBe('not_found')
    expect(getIssueDetail(db, 1, 7)?.fetchedAt).toBe(NOW)
  })

  it('받는 사이 로그아웃하면 아무것도 쓰지 않는다(세대 확인)', async () => {
    replaceMyRepositories(db, [repoRecord(1)])
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.issueDetail]: () => {
          clearFetchedData(db)
          return detailResponse(rawDetail())()
        }
      }
    })
    await expect(
      refreshIssueDetail({
        db,
        client,
        repoId: 1,
        number: 7,
        now: NOW,
        isCurrent: currentDataGuard()
      })
    ).rejects.toBeInstanceOf(StaleRefreshError)
    expect(db.prepare('SELECT COUNT(*) AS n FROM cache_issue_details').get()).toEqual({ n: 0 })
  })

  it('상세 캐시는 로그아웃 정리(clearFetchedData)에 지워진다', () => {
    replaceMyRepositories(db, [repoRecord(1)])
    saveIssueDetail(
      db,
      {
        id: 'I_1',
        repoId: 1,
        repoFullName: 'me/repo1',
        number: 1,
        url: '',
        title: 't',
        state: 'open',
        stateReason: null,
        author: { login: 'a', avatarUrl: null, isBot: false },
        createdAt: '2026-10-01T00:00:00Z',
        bodyHTML: '',
        labels: [],
        assignees: [],
        reactions: [],
        comments: [],
        commentCount: 0,
        linkedPullRequests: [],
        referencingCommits: [],
        locked: false,
        viewerCanClose: true,
        viewerCanReopen: false,
        viewerCanReact: true,
        viewerPermission: 'ADMIN'
      },
      NOW
    )
    expect(getIssueDetail(db, 1, 1)).not.toBeNull()
    clearFetchedData(db)
    expect(getIssueDetail(db, 1, 1)).toBeNull()
  })
})
