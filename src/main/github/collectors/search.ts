import type { IssueRecord, PullRequestRecord } from '../../cache/types'
import type { GitHubClient } from '../client'
import { resolveClient } from './common'
import type { ListResult } from './common'
import { compact, mapIssue, mapPullRequest } from './map'
import {
  ASSIGNED_ISSUES_QUERY,
  MY_ISSUES_QUERY,
  MY_PULL_REQUESTS_QUERY,
  OPERATIONS,
  REVIEW_REQUESTS_QUERY,
  SEARCH_QUERIES
} from './queries'
import type { RawIssue, RawPageInfo, RawPullRequest } from './raw'
import { collectPages } from './repositories'
import type { PagedOptions } from './repositories'

/**
 * 검색 기반 목록. 검색 결과 상한(1000)과 요청 한도를 생각해 기본 50개씩 최대 4쪽만 받는다.
 */

interface SearchData<T> {
  viewer?: { login?: string | null } | null
  search?: { pageInfo?: RawPageInfo | null; nodes?: (T | null)[] | null } | null
}

async function search<Raw, Out extends { id: string }>(
  client: GitHubClient,
  options: PagedOptions,
  doc: string,
  operationName: string,
  q: string,
  map: (raw: Raw, viewerLogin: string | null) => Out | null
): Promise<ListResult<Out>> {
  const result = await collectPages<Out>(
    { ...options, pageSize: options.pageSize ?? 50, maxPages: options.maxPages ?? 4 },
    async (cursor, pageSize) => {
      const res = await client.graphql<SearchData<Raw>>(
        doc,
        { q, cursor, pageSize },
        { operationName, signal: options.signal }
      )
      const viewer = res.data.viewer?.login ?? null
      return {
        items: compact(res.data.search?.nodes)
          .map((n) => map(n, viewer))
          .filter((x): x is Out => x !== null),
        pageInfo: res.data.search?.pageInfo,
        orgRestrictions: res.orgRestrictions
      }
    }
  )
  const seen = new Set<string>()
  return { ...result, items: result.items.filter((x) => !seen.has(x.id) && seen.add(x.id)) }
}

function prOnly(raw: RawPullRequest, viewer: string | null): PullRequestRecord | null {
  return raw.__typename === 'PullRequest' ? mapPullRequest(raw, viewer) : null
}

function issueOnly(raw: RawIssue, viewer: string | null): IssueRecord | null {
  return raw.__typename === 'Issue' ? mapIssue(raw, viewer) : null
}

/** 내가 올린 열린 PR (spec §4.4), 저장소 무관 */
export async function collectMyPullRequests(
  options: PagedOptions = {}
): Promise<ListResult<PullRequestRecord>> {
  const result = await search(
    resolveClient(options),
    options,
    MY_PULL_REQUESTS_QUERY,
    OPERATIONS.myPullRequests,
    SEARCH_QUERIES.myPullRequests,
    prOnly
  )
  // author:@me 검색이므로 모두 내가 작성한 것이다
  return { ...result, items: result.items.map((p) => ({ ...p, viewerIsAuthor: true })) }
}

/** 나 또는 내가 속한 팀에 리뷰가 요청된 열린 PR (spec §4.5). review-requested:@me 는 팀 요청도 포함한다 */
export async function collectReviewRequests(
  options: PagedOptions = {}
): Promise<ListResult<PullRequestRecord>> {
  return search(
    resolveClient(options),
    options,
    REVIEW_REQUESTS_QUERY,
    OPERATIONS.reviewRequests,
    SEARCH_QUERIES.reviewRequests,
    prOnly
  )
}

/** 나에게 할당된 열린 이슈 (PR 제외) */
export async function collectAssignedIssues(
  options: PagedOptions = {}
): Promise<ListResult<IssueRecord>> {
  return search(
    resolveClient(options),
    options,
    ASSIGNED_ISSUES_QUERY,
    OPERATIONS.assignedIssues,
    SEARCH_QUERIES.assignedIssues,
    issueOnly
  )
}

/** 내가 올린 열린 이슈 (PR 제외) */
export async function collectMyIssues(
  options: PagedOptions = {}
): Promise<ListResult<IssueRecord>> {
  const result = await search(
    resolveClient(options),
    options,
    MY_ISSUES_QUERY,
    OPERATIONS.myIssues,
    SEARCH_QUERIES.myIssues,
    issueOnly
  )
  return { ...result, items: result.items.map((i) => ({ ...i, viewerIsAuthor: true })) }
}
