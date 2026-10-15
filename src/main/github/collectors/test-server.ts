import { vi } from 'vitest'
import type { GitHubClient } from '../client'
import { createGitHubClientForTests } from '../client/testing'

/**
 * 단위 테스트 전용 가짜 GitHub. GraphQL 은 operationName 으로, REST 는 "메서드 경로"(쿼리 제외)로 응답을 고른다.
 */
export const TEST_BASE = 'https://api.test'

export interface GraphQLCall {
  operationName: string
  query: string
  variables: Record<string, unknown>
}

export type GraphQLHandler = (variables: Record<string, unknown>, call: number) => unknown
export type RestHandler = (url: URL, headers: Headers, call: number) => Response

export interface FakeCall {
  method: string
  /** GraphQL 은 operationName, REST 는 "GET /path" */
  key: string
  url: string
  headers: Headers
  graphql?: GraphQLCall
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 || status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })
}

/** Link 헤더 만들기: { next: 'url', last: 'url' } */
export function link(rels: Record<string, string>): string {
  return Object.entries(rels)
    .map(([rel, url]) => `<${url}>; rel="${rel}"`)
    .join(', ')
}

export function fakeGitHub(routes: {
  graphql?: Record<string, GraphQLHandler>
  rest?: Record<string, RestHandler>
}): { client: GitHubClient; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const counts = new Map<string, number>()
  const next = (key: string): number => {
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return n
  }
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    if (url.pathname === '/graphql') {
      const body = JSON.parse(String(init?.body)) as GraphQLCall
      calls.push({ method, key: body.operationName, url: url.href, headers, graphql: body })
      const handler = routes.graphql?.[body.operationName]
      if (!handler) return json({ message: `no handler for ${body.operationName}` }, 500)
      return json(handler(body.variables ?? {}, next(body.operationName)))
    }
    const key = `${method} ${url.pathname}`
    calls.push({ method, key, url: url.href, headers })
    const handler = routes.rest?.[key]
    if (!handler) return json({ message: 'Not Found' }, 404)
    return handler(url, headers, next(key))
  })
  const client = createGitHubClientForTests({
    tokenProvider: () => 'test-token',
    fetch: fetchFn as unknown as typeof fetch,
    baseUrl: TEST_BASE
  })
  return { client, calls }
}

/** GraphQL 조직 제한 오류 항목 */
export function orgRestrictionError(org: string): { type: string; message: string } {
  return {
    type: 'FORBIDDEN',
    message: `Although you appear to have the correct authorization credentials, the \`${org}\` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.`
  }
}

/** 응답용 저장소 노드 */
export function rawRepo(id: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const owner = (patch.ownerLogin as string | undefined) ?? 'me'
  const name = (patch.name as string | undefined) ?? `repo${id}`
  return {
    id: `R_${id}`,
    databaseId: id,
    name,
    nameWithOwner: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    description: null,
    homepageUrl: '',
    owner: { __typename: owner === 'me' ? 'User' : 'Organization', login: owner, avatarUrl: null },
    primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
    defaultBranchRef: { name: 'main' },
    licenseInfo: { spdxId: 'MIT', name: 'MIT License' },
    stargazerCount: 3,
    forkCount: 0,
    pullRequests: { totalCount: 0 },
    issues: { totalCount: 0 },
    pushedAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    repositoryTopics: { nodes: [] },
    viewerPermission: 'ADMIN',
    viewerHasStarred: false,
    ...patch
  }
}

export function rawPr(
  id: string,
  repoId: number,
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    __typename: 'PullRequest',
    id,
    number: 1,
    title: `PR ${id}`,
    url: `https://github.com/me/repo${repoId}/pull/1`,
    isDraft: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    reviewDecision: null,
    authorAssociation: 'CONTRIBUTOR',
    author: { __typename: 'User', login: 'someone', avatarUrl: 'https://avatars/someone' },
    repository: { databaseId: repoId, nameWithOwner: `me/repo${repoId}` },
    comments: { totalCount: 0, nodes: [] },
    reviews: { totalCount: 0, nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...patch
  }
}

export function rawIssue(
  id: string,
  repoId: number,
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    __typename: 'Issue',
    id,
    number: 2,
    title: `Issue ${id}`,
    url: `https://github.com/me/repo${repoId}/issues/2`,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    authorAssociation: 'NONE',
    author: { __typename: 'User', login: 'someone', avatarUrl: null },
    repository: { databaseId: repoId, nameWithOwner: `me/repo${repoId}` },
    labels: { nodes: [] },
    comments: { totalCount: 0, nodes: [] },
    ...patch
  }
}
