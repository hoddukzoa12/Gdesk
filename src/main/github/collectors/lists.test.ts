import { describe, expect, it } from 'vitest'
import { collectRepoOpenItems } from './items'
import {
  collectAssignedIssues,
  collectMyIssues,
  collectMyPullRequests,
  collectReviewRequests
} from './search'
import { collectMyRepositories, collectStarredRepositories } from './repositories'
import { OPERATIONS, SEARCH_QUERIES } from './queries'
import { fakeGitHub, orgRestrictionError, rawIssue, rawPr, rawRepo } from './test-server'

function page(nodes: unknown[], hasNextPage: boolean, endCursor: string | null = null) {
  return { pageInfo: { hasNextPage, endCursor }, nodes }
}

describe('collectMyRepositories', () => {
  it('쓰기 권한 저장소만, 페이지를 따라 모은다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: (vars) =>
          vars.cursor === undefined || vars.cursor === null
            ? {
                data: {
                  viewer: {
                    login: 'me',
                    repositories: page(
                      [
                        rawRepo(1, { viewerPermission: 'ADMIN', isFork: true }),
                        rawRepo(2, { viewerPermission: 'READ' }),
                        rawRepo(3, { viewerPermission: 'TRIAGE' })
                      ],
                      true,
                      'c1'
                    )
                  }
                }
              }
            : {
                data: {
                  viewer: {
                    login: 'me',
                    repositories: page(
                      [
                        rawRepo(4, {
                          viewerPermission: 'WRITE',
                          ownerLogin: 'acme',
                          isArchived: true,
                          isPrivate: true,
                          repositoryTopics: { nodes: [{ topic: { name: 'cli' } }] },
                          licenseInfo: { spdxId: 'NOASSERTION', name: 'Other' }
                        }),
                        rawRepo(5, { viewerPermission: 'MAINTAIN' }),
                        null
                      ],
                      false
                    )
                  }
                }
              }
      }
    })
    const result = await collectMyRepositories({ client })
    expect(result.complete).toBe(true)
    expect(result.viewerLogin).toBe('me')
    expect(result.orgRestrictions).toEqual([])
    expect(result.items.map((r) => r.id)).toEqual([1, 4, 5])
    expect(result.items[0]).toMatchObject({ fork: true, nodeId: 'R_1', homepageUrl: null })
    expect(result.items[1]).toMatchObject({
      owner: 'acme',
      ownerType: 'Organization',
      fullName: 'acme/repo4',
      archived: true,
      private: true,
      topics: ['cli'],
      license: 'Other',
      viewerPermission: 'WRITE'
    })
    expect(calls.map((c) => c.key)).toEqual([OPERATIONS.myRepositories, OPERATIONS.myRepositories])
    expect(calls[1]?.graphql?.variables.cursor).toBe('c1')
    // 조직 저장소가 빠지지 않도록 두 affiliation 을 모두 넘긴다
    expect(calls[0]?.graphql?.query).toContain(
      'ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]'
    )
  })

  it('부분 오류의 조직 제한은 기록하고 수집은 계속한다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({
          data: { viewer: { login: 'me', repositories: page([rawRepo(1), null], false) } },
          errors: [orgRestrictionError('acme')]
        })
      }
    })
    const result = await collectMyRepositories({ client })
    expect(result.items.map((r) => r.id)).toEqual([1])
    expect(result.complete).toBe(true)
    expect(result.orgRestrictions).toEqual([
      expect.objectContaining({ orgLogin: 'acme', reason: 'oauth_app_restriction' })
    ])
  })

  it('쿼리 전체가 조직 제한으로 막혀도 던지지 않고 불완전으로 표시한다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({ data: null, errors: [orgRestrictionError('acme')] })
      }
    })
    const result = await collectMyRepositories({ client })
    expect(result.complete).toBe(false)
    expect(result.items).toEqual([])
    expect(result.orgRestrictions[0]).toMatchObject({ orgLogin: 'acme' })
  })

  it('조직 제한이 아닌 오류는 던진다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({ data: null, errors: [{ message: 'boom' }] })
      }
    })
    await expect(collectMyRepositories({ client })).rejects.toThrow(/boom/)
  })
})

describe('collectStarredRepositories', () => {
  it('스타한 시각과 함께 모은다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.starredRepositories]: () => ({
          data: {
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [
                  {
                    starredAt: '2026-10-05T00:00:00Z',
                    node: rawRepo(7, { viewerPermission: 'READ' })
                  },
                  { starredAt: '2026-10-01T00:00:00Z', node: null }
                ]
              }
            }
          }
        })
      }
    })
    const result = await collectStarredRepositories({ client })
    expect(result.items).toEqual([
      expect.objectContaining({
        starredAt: '2026-10-05T00:00:00Z',
        repository: expect.objectContaining({ id: 7, viewerPermission: 'READ' })
      })
    ])
  })
})

describe('collectRepoOpenItems', () => {
  it('열린 항목이 있는 저장소만 묶어서 요청하고 판정 재료를 만든다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.repoOpenItems]: (vars) => {
          const ids = vars.ids as string[]
          return {
            data: {
              viewer: { login: 'Me' },
              nodes: ids.map((id) =>
                id === 'R_3'
                  ? null
                  : {
                      databaseId: Number(id.slice(2)),
                      openPullRequests: {
                        totalCount: 2,
                        nodes: [
                          rawPr(`PR_${id}`, Number(id.slice(2)), {
                            isDraft: true,
                            reviewDecision: 'CHANGES_REQUESTED',
                            commits: {
                              nodes: [{ commit: { statusCheckRollup: { state: 'ERROR' } } }]
                            },
                            comments: { totalCount: 1, nodes: [{ authorAssociation: 'NONE' }] },
                            reviews: { totalCount: 1, nodes: [{ authorAssociation: 'MEMBER' }] }
                          }),
                          rawPr(`MINE_${id}`, Number(id.slice(2)), {
                            author: { __typename: 'User', login: 'me', avatarUrl: null },
                            authorAssociation: 'OWNER'
                          })
                        ]
                      },
                      openIssues: {
                        totalCount: 1,
                        nodes: [
                          rawIssue(`I_${id}`, Number(id.slice(2)), {
                            author: { __typename: 'Bot', login: 'renovate', avatarUrl: null },
                            labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
                            comments: { totalCount: 3, nodes: [{ authorAssociation: 'NONE' }] }
                          })
                        ]
                      }
                    }
              )
            }
          }
        }
      }
    })
    const result = await collectRepoOpenItems(
      [
        { id: 1, nodeId: 'R_1', openPullRequestCount: 2, openIssueCount: 1 },
        { id: 2, nodeId: 'R_2', openPullRequestCount: 0, openIssueCount: 0 },
        { id: 3, nodeId: 'R_3', openPullRequestCount: 1, openIssueCount: 0 },
        { id: 4, nodeId: null, openPullRequestCount: 1, openIssueCount: 0 }
      ],
      { client, batchSize: 10 }
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.graphql?.variables.ids).toEqual(['R_1', 'R_3'])
    // 2: 열린 항목 없음 → 요청 없이 빈 목록. 3: 응답이 null → 결과 없음(기존 캐시 유지). 4: 노드 ID 없음
    expect(result.repos.map((r) => r.repoId)).toEqual([2, 1])
    const repo1 = result.repos.find((r) => r.repoId === 1)!
    expect(repo1.pullRequests[0]).toMatchObject({
      id: 'PR_R_1',
      state: 'draft',
      reviewStatus: 'changes_requested',
      ciStatus: 'failing',
      viewerIsAuthor: false,
      authorAssociation: 'CONTRIBUTOR',
      hasWriteHolderResponse: true,
      commentCount: 1,
      author: { login: 'someone', avatarUrl: 'https://avatars/someone', isBot: false }
    })
    expect(repo1.pullRequests[1]).toMatchObject({ viewerIsAuthor: true, ciStatus: 'none' })
    expect(repo1.issues[0]).toMatchObject({
      author: { login: 'renovate', isBot: true },
      labels: [{ name: 'bug', color: 'd73a4a' }],
      commentCount: 3,
      // 3개 중 1개만 받았으므로 응답이 있었다고 본다
      hasWriteHolderResponse: true
    })
    expect(result.repos.find((r) => r.repoId === 2)).toEqual({
      repoId: 2,
      pullRequests: [],
      issues: []
    })
  })

  it('묶음 크기대로 나눠 요청하고, 조직 제한 묶음은 건너뛴다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.repoOpenItems]: (vars, call) =>
          call === 1
            ? { data: null, errors: [orgRestrictionError('acme')] }
            : {
                data: {
                  viewer: { login: 'me' },
                  nodes: (vars.ids as string[]).map((id) => ({
                    databaseId: Number(id.slice(2)),
                    openPullRequests: { totalCount: 0, nodes: [] },
                    openIssues: { totalCount: 0, nodes: [] }
                  }))
                }
              }
      }
    })
    const targets = [1, 2, 3].map((id) => ({
      id,
      nodeId: `R_${id}`,
      openPullRequestCount: 1,
      openIssueCount: 0
    }))
    const result = await collectRepoOpenItems(targets, { client, batchSize: 2 })
    expect(calls.map((c) => c.graphql?.variables.ids)).toEqual([['R_1', 'R_2'], ['R_3']])
    expect(result.repos.map((r) => r.repoId)).toEqual([3])
    expect(result.orgRestrictions[0]).toMatchObject({ orgLogin: 'acme' })
  })
})

describe('검색 목록', () => {
  function searchServer(op: string, nodes: unknown[]) {
    return fakeGitHub({
      graphql: {
        [op]: () => ({
          data: {
            viewer: { login: 'me' },
            search: {
              issueCount: nodes.length,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes
            }
          }
        })
      }
    })
  }

  it('내가 올린 PR: author:@me 검색, 중복 제거', async () => {
    const { client, calls } = searchServer(OPERATIONS.myPullRequests, [
      rawPr('A', 1, { author: { __typename: 'User', login: 'me', avatarUrl: null } }),
      rawPr('A', 1, { author: { __typename: 'User', login: 'me', avatarUrl: null } })
    ])
    const result = await collectMyPullRequests({ client })
    expect(calls[0]?.graphql?.variables.q).toBe(SEARCH_QUERIES.myPullRequests)
    expect(result.items.map((p) => [p.id, p.viewerIsAuthor])).toEqual([['A', true]])
  })

  it('리뷰 요청: review-requested:@me (개인·팀 모두)', async () => {
    const { client, calls } = searchServer(OPERATIONS.reviewRequests, [rawPr('R', 9)])
    const result = await collectReviewRequests({ client })
    expect(calls[0]?.graphql?.variables.q).toContain('review-requested:@me')
    expect(result.items.map((p) => p.id)).toEqual(['R'])
  })

  it('이슈 목록에 PR 은 섞이지 않는다', async () => {
    const { client } = searchServer(OPERATIONS.assignedIssues, [
      rawIssue('I1', 1),
      { __typename: 'PullRequest' },
      rawPr('P1', 1)
    ])
    const result = await collectAssignedIssues({ client })
    expect(result.items.map((i) => i.id)).toEqual(['I1'])
  })

  it('내가 올린 이슈', async () => {
    const { client, calls } = searchServer(OPERATIONS.myIssues, [
      rawIssue('I2', 1, { author: { __typename: 'User', login: 'me', avatarUrl: null } })
    ])
    const result = await collectMyIssues({ client })
    expect(calls[0]?.graphql?.variables.q).toBe(SEARCH_QUERIES.myIssues)
    expect(result.items[0]).toMatchObject({ id: 'I2', viewerIsAuthor: true })
  })

  it('페이지를 따라가되 maxPages 에서 멈추고 불완전으로 표시한다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: {
        [OPERATIONS.myIssues]: (_vars, call) => ({
          data: {
            viewer: { login: 'me' },
            search: {
              issueCount: 999,
              pageInfo: { hasNextPage: true, endCursor: `c${call}` },
              nodes: [rawIssue(`I${call}`, 1)]
            }
          }
        })
      }
    })
    const result = await collectMyIssues({ client, maxPages: 2 })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.graphql?.variables.cursor).toBe('c1')
    expect(result.complete).toBe(false)
    expect(result.items.map((i) => i.id)).toEqual(['I1', 'I2'])
  })
})
