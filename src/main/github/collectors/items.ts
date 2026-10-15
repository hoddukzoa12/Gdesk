import type { IssueRecord, PullRequestRecord } from '../../cache/types'
import type { OrgRestriction } from '../client'
import { orgRestrictionsFrom, resolveClient } from './common'
import type { CollectorOptions } from './common'
import { compact, mapIssue, mapPullRequest } from './map'
import { OPERATIONS, REPO_OPEN_ITEMS_QUERY } from './queries'
import type { RawConnection, RawIssue, RawPullRequest } from './raw'

/**
 * 내 저장소 집합의 열린 PR·이슈 (들어온 PR·이슈, 응답 없는 새 기여의 재료).
 * 저장소 목록 쿼리가 준 열린 수가 0 인 저장소는 요청하지 않고, 나머지는 노드 ID 묶음으로 한 번에 받는다.
 * 저장소마다 최근 갱신 순 itemCount 개(기본 50)까지만 받는다.
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
}

export interface RepoOpenItemsOptions extends CollectorOptions {
  /** 한 요청에 묶을 저장소 수. 기본 10 */
  batchSize?: number
  /** 저장소마다 받을 PR·이슈 수. 기본 50 */
  itemCount?: number
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
  const itemCount = Math.min(100, Math.max(1, options.itemCount ?? 50))
  const repos: RepoOpenItems[] = []
  const orgRestrictions: OrgRestriction[] = []
  let viewerLogin: string | null = null

  const toFetch: (RepoOpenItemsTarget & { nodeId: string })[] = []
  for (const t of targets) {
    if (t.openPullRequestCount <= 0 && t.openIssueCount <= 0) {
      repos.push({ repoId: t.id, pullRequests: [], issues: [] })
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
        { ids: batch.map((t) => t.nodeId), itemCount },
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
      repos.push({
        repoId: target.id,
        pullRequests: compact(node.openPullRequests?.nodes)
          .map((p) => mapPullRequest(p, viewerLogin))
          .filter((p): p is PullRequestRecord => p !== null),
        issues: compact(node.openIssues?.nodes)
          .map((x) => mapIssue(x, viewerLogin))
          .filter((x): x is IssueRecord => x !== null)
      })
    })
  }
  return { repos, orgRestrictions, viewerLogin }
}
