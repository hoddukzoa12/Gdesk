import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getIssueTabCounts,
  listAssignedIssues,
  listIncomingIssues,
  listMentionedIssues
} from '../../cache/issues'
import { listIssueRepoOptions } from '../../cache/repositories'
import { getSyncState } from '../../cache/sync-state'
import { openDatabase } from '../../db/connection'
import { collectMyRepositories } from './repositories'
import { OPERATIONS, SEARCH_QUERIES } from './queries'
import {
  SYNC_SCOPES,
  refreshIssueLists,
  refreshMentionedIssues,
  refreshMyRepositories,
  refreshRepoOpenItems
} from './refresh'
import { collectMentionedIssues } from './search'
import { fakeGitHub, orgRestrictionError, rawIssue, rawRepo } from './test-server'

const NOW = Date.UTC(2026, 9, 16, 12)

function searchResponse(nodes: unknown[], issueCount = nodes.length) {
  return () => ({
    data: {
      viewer: { login: 'me' },
      search: { issueCount, pageInfo: { hasNextPage: false, endCursor: null }, nodes }
    }
  })
}

describe('나를 언급한 이슈 (mentions:@me)', () => {
  it('검색어·operationName, PR 은 버리고 전체 수는 issueCount', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.mentionedIssues]: searchResponse(
          [rawIssue('I1', 9, { repository: { databaseId: 9, nameWithOwner: 'other/lib' } })],
          120
        )
      }
    })
    const result = await collectMentionedIssues({ client })
    expect(calls[0]?.key).toBe('GdeskMentionedIssues')
    expect(calls[0]?.graphql?.variables.q).toBe(SEARCH_QUERIES.mentionedIssues)
    expect(SEARCH_QUERIES.mentionedIssues).toContain('mentions:@me')
    expect(SEARCH_QUERIES.mentionedIssues).toContain('is:issue')
    expect(SEARCH_QUERIES.mentionedIssues).toContain('is:open')
    expect(result.items.map((i) => i.id)).toEqual(['I1'])
    expect(result.totalCount).toBe(120)
  })
})

describe('이슈 행의 담당자', () => {
  it('assignees 노드를 login·아바타로 바꾸고 빈 값은 버린다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.mentionedIssues]: searchResponse([
          rawIssue('I1', 1, {
            assignees: {
              nodes: [
                { __typename: 'User', login: 'bob', avatarUrl: 'https://avatars/bob' },
                null,
                { __typename: 'Bot', login: 'copilot[bot]', avatarUrl: null }
              ]
            }
          }),
          // 응답에 assignees 가 없으면 빈 목록
          rawIssue('I2', 1, { assignees: undefined })
        ])
      }
    })
    const result = await collectMentionedIssues({ client })
    expect(result.items[0]?.assignees).toEqual([
      { login: 'bob', avatarUrl: 'https://avatars/bob', isBot: false },
      { login: 'copilot[bot]', avatarUrl: null, isBot: true }
    ])
    expect(result.items[1]?.assignees).toEqual([])
  })
})

describe('저장소의 hasIssuesEnabled', () => {
  it('false 만 꺼진 것으로 본다(응답에 없으면 켜짐)', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({
          data: {
            viewer: {
              login: 'me',
              repositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  rawRepo(1, { hasIssuesEnabled: false }),
                  rawRepo(2, { hasIssuesEnabled: true }),
                  rawRepo(3, { hasIssuesEnabled: undefined })
                ]
              }
            }
          }
        })
      }
    })
    const result = await collectMyRepositories({ client })
    expect(result.items.map((r) => [r.id, r.hasIssuesEnabled])).toEqual([
      [1, false],
      [2, true],
      [3, true]
    ])
  })
})

describe('이슈 목록 갱신과 탭 수', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('언급 목록을 따로 저장하고, 네 탭의 수를 GitHub 전체 수로 센다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({
          data: {
            viewer: {
              login: 'me',
              repositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  rawRepo(1, { issues: { totalCount: 2 }, hasIssuesEnabled: false }),
                  rawRepo(2, { isFork: true }),
                  rawRepo(3, { isArchived: true }),
                  rawRepo(4)
                ]
              }
            }
          }
        }),
        [OPERATIONS.repoOpenItems]: () => ({
          data: {
            viewer: { login: 'me' },
            nodes: [
              {
                databaseId: 1,
                openPullRequests: { totalCount: 0, nodes: [] },
                openIssues: {
                  totalCount: 2,
                  nodes: [
                    rawIssue('Iin', 1, {
                      assignees: {
                        nodes: [{ __typename: 'User', login: 'bob', avatarUrl: null }]
                      }
                    }),
                    rawIssue('Imine', 1, {
                      author: { __typename: 'User', login: 'me', avatarUrl: null }
                    })
                  ]
                }
              }
            ]
          }
        }),
        [OPERATIONS.assignedIssues]: searchResponse([rawIssue('Ias', 1)], 7),
        [OPERATIONS.myIssues]: searchResponse([], 0),
        [OPERATIONS.mentionedIssues]: searchResponse(
          [rawIssue('Imen', 9), rawIssue('Imen2', 9)],
          51
        )
      }
    })
    await refreshMyRepositories({ db, client, now: NOW })
    await refreshRepoOpenItems({ db, client, now: NOW })
    await refreshIssueLists({ db, client, now: NOW })
    // 언급 목록은 따로 받는다(실패해도 할당·내 이슈 목록에 영향이 없게)
    expect(listMentionedIssues(db).items).toEqual([])
    await refreshMentionedIssues({ db, client, now: NOW })

    expect(listMentionedIssues(db).items.map((i) => i.id)).toEqual(['Imen', 'Imen2'])
    expect(listMentionedIssues(db)).toMatchObject({ totalCount: 51, complete: false })
    expect(getSyncState(db, SYNC_SCOPES.mentionedIssues).lastSyncedAt).toBe(NOW)
    expect(listIncomingIssues(db).items[0]?.assignees).toEqual([
      { login: 'bob', avatarUrl: null, isBot: false }
    ])
    expect(listAssignedIssues(db).totalCount).toBe(7)
    expect(getIssueTabCounts(db)).toEqual({ incoming: 1, assigned: 7, mentioned: 51, mine: 0 })

    // 새 이슈 저장소 선택: 포크·보관 제외, 이슈 꺼짐도 보이며 권한과 함께
    expect(listIssueRepoOptions(db).map((r) => [r.repoId, r.hasIssuesEnabled])).toEqual([
      [1, false],
      [4, true]
    ])
    expect(listIssueRepoOptions(db)[0]).toEqual({
      repoId: 1,
      owner: 'me',
      name: 'repo1',
      fullName: 'me/repo1',
      ownerAvatarUrl: null,
      private: false,
      hasIssuesEnabled: false,
      viewerPermission: 'ADMIN'
    })
  })

  it('언급 목록이 첫 페이지부터 조직 제한으로 비면 기존 목록을 지우지 않는다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.mentionedIssues]: (_v, call) =>
          call === 1
            ? searchResponse([rawIssue('Imen', 9)])()
            : { data: null, errors: [orgRestrictionError('acme')] }
      }
    })
    await refreshMentionedIssues({ db, client, now: NOW })
    await refreshMentionedIssues({ db, client, now: NOW + 1 })
    expect(listMentionedIssues(db).items.map((i) => i.id)).toEqual(['Imen'])
  })
})
