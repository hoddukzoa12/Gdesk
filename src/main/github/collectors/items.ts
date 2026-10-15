import type { IssueRecord, PullRequestRecord } from '../../cache/types'
import type { OrgRestriction } from '../client'
import { orgRestrictionsFrom, resolveClient } from './common'
import type { CollectorOptions } from './common'
import { compact, mapIssue, mapPullRequest } from './map'
import { LIST_LIMITS, OPERATIONS, REPO_OPEN_ITEMS_QUERY, RESPONSE_SAMPLE } from './queries'
import type { RawConnection, RawIssue, RawPullRequest } from './raw'

/**
 * 내 저장소 집합의 열린 PR·이슈 (들어온 PR·이슈, 응답 없는 새 기여의 재료).
 * 저장소 목록 쿼리가 준 열린 수가 0 인 저장소는 요청하지 않고, 나머지는 노드 ID 묶음으로 한 번에 받는다.
 * 저장소마다 최근 갱신 순 itemCount 개(기본 50, 조정 가능)까지만 받고, 전체 수(totalCount)를 함께 돌려준다.
 */
export interface RepoOpenItemsTarget {
  id: number
  nodeId: string | null
  openPullRequestCount: number
  openIssueCount: number
}

export interface RepoOpenItems {
  repoId: number
  pullRequests: PullRequestRecord[]
  issues: IssueRecord[]
  /** 그 저장소의 열린 PR 전체 수(GitHub totalCount). 받은 수보다 크면 잘린 것 */
  pullRequestTotal: number
  issueTotal: number
}

export interface RepoOpenItemsOptions extends CollectorOptions {
  /** 한 요청에 묶을 저장소 수. 기본 10 */
  batchSize?: number
  /** 저장소마다 받을 PR·이슈 수. 기본 LIST_LIMITS.repoOpenItems(50) */
  itemCount?: number
  /** 응답 없는 새 기여 판정용 최근 코멘트·리뷰 수. 기본 RESPONSE_SAMPLE(50) */
  responseCount?: number
}

interface OpenItemsData {
  viewer?: { login?: string | null } | null
  nodes?:
    | ({
        databaseId?: number | null
        openPullRequests?: RawConnection<RawPullRequest> | null
        openIssues?: RawConnection<RawIssue> | null
      } | null)[]
    | null
}

/**
 * 결과에는 받은 저장소만 들어간다. 응답이 없거나(null, 조직 제한) 노드 ID 가 없는 저장소는 빠지므로
 * 호출자는 그 저장소의 기존 캐시를 그대로 둔다.
 */
export async function collectRepoOpenItems(
  targets: readonly RepoOpenItemsTarget[],
  options: RepoOpenItemsOptions = {}
): Promise<{
  repos: RepoOpenItems[]
  orgRestrictions: OrgRestriction[]
  viewerLogin: string | null
}> {
  const client = resolveClient(options)
  const batchSize = Math.max(1, options.batchSize ?? 10)
  const itemCount = Math.min(100, Math.max(1, options.itemCount ?? LIST_LIMITS.repoOpenItems))
  const responseCount = Math.min(100, Math.max(1, options.responseCount ?? RESPONSE_SAMPLE))
  const repos: RepoOpenItems[] = []
  const orgRestrictions: OrgRestriction[] = []
  let viewerLogin: string | null = null

  const toFetch: (RepoOpenItemsTarget & { nodeId: string })[] = []
  for (const t of targets) {
    if (t.openPullRequestCount <= 0 && t.openIssueCount <= 0) {
      repos.push({ repoId: t.id, pullRequests: [], issues: [], pullRequestTotal: 0, issueTotal: 0 })
    } else if (t.nodeId) {
      toFetch.push({ ...t, nodeId: t.nodeId })
    }
  }

  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize)
    let res
    try {
      res = await client.graphql<OpenItemsData>(
        REPO_OPEN_ITEMS_QUERY,
        { ids: batch.map((t) => t.nodeId), itemCount, responseCount },
        { operationName: OPERATIONS.repoOpenItems, signal: options.signal }
      )
    } catch (error) {
      const restrictions = orgRestrictionsFrom(error)
      if (!restrictions) throw error
      orgRestrictions.push(...restrictions)
      continue
    }
    orgRestrictions.push(...res.orgRestrictions)
    viewerLogin = res.data.viewer?.login ?? viewerLogin
    const nodes = res.data.nodes ?? []
    batch.forEach((target, index) => {
      const node = nodes[index]
      if (!node) return
      const pullRequests = compact(node.openPullRequests?.nodes)
        .map((p) => mapPullRequest(p, viewerLogin))
        .filter((p): p is PullRequestRecord => p !== null)
      const issues = compact(node.openIssues?.nodes)
        .map((x) => mapIssue(x, viewerLogin))
        .filter((x): x is IssueRecord => x !== null)
      repos.push({
        repoId: target.id,
        pullRequests,
        issues,
        pullRequestTotal: Math.max(node.openPullRequests?.totalCount ?? 0, pullRequests.length),
        issueTotal: Math.max(node.openIssues?.totalCount ?? 0, issues.length)
      })
    })
  }
  return { repos, orgRestrictions, viewerLogin }
}
