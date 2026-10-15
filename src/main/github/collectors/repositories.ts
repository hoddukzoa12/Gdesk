import { WRITE_PERMISSIONS } from '@shared/domain/repo'
import type { RepositoryRecord, StarredRepositoryRecord } from '../../cache/types'
import type { OrgRestriction } from '../client'
import { orgRestrictionsFrom, resolveClient } from './common'
import type { CollectorOptions, ListResult } from './common'
import { compact, mapRepository } from './map'
import { MY_REPOSITORIES_QUERY, OPERATIONS, STARRED_REPOSITORIES_QUERY } from './queries'
import type { RawPageInfo, RawRepository } from './raw'

export interface PagedOptions extends CollectorOptions {
  /** 페이지 크기(최대 100). 기본 100 */
  pageSize?: number
  /** 최대 페이지 수. 기본 30 */
  maxPages?: number
}

/**
 * 커서 페이지를 차례로 받는다. 조직 제한으로 막히면 거기서 멈추고 불완전으로 표시한다.
 */
async function collectPages<T>(
  options: PagedOptions,
  fetchPage: (
    cursor: string | null,
    pageSize: number
  ) => Promise<{
    items: T[]
    pageInfo: RawPageInfo | null | undefined
    orgRestrictions: OrgRestriction[]
    totalCount?: number | null
  }>
): Promise<ListResult<T>> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 100))
  const maxPages = options.maxPages ?? 30
  const items: T[] = []
  const orgRestrictions: OrgRestriction[] = []
  let cursor: string | null = null
  let totalCount: number | null = null
  for (let page = 0; page < maxPages; page++) {
    let result
    try {
      result = await fetchPage(cursor, pageSize)
    } catch (error) {
      const restrictions = orgRestrictionsFrom(error)
      if (!restrictions) throw error
      orgRestrictions.push(...restrictions)
      return { items, complete: false, orgRestrictions, totalCount }
    }
    totalCount = result.totalCount ?? totalCount
    items.push(...result.items)
    orgRestrictions.push(...result.orgRestrictions)
    const next = result.pageInfo?.hasNextPage ? (result.pageInfo.endCursor ?? null) : null
    if (next === null) return { items, complete: true, orgRestrictions, totalCount }
    cursor = next
  }
  return { items, complete: false, orgRestrictions, totalCount }
}

interface MyRepositoriesData {
  viewer?: {
    login?: string | null
    repositories?: { pageInfo?: RawPageInfo | null; nodes?: (RawRepository | null)[] | null } | null
  } | null
}

/**
 * 내 저장소 집합 (spec §3): 소유 + 쓰기 권한(push·maintain·admin), 조직·협업자·비공개 포함.
 * viewer.repositories 에 affiliations 와 ownerAffiliations 를 모두 넘기고 viewerPermission 으로 거른다.
 */
export async function collectMyRepositories(
  options: PagedOptions = {}
): Promise<ListResult<RepositoryRecord> & { viewerLogin: string | null }> {
  const client = resolveClient(options)
  let viewerLogin: string | null = null
  const result = await collectPages(options, async (cursor, pageSize) => {
    const res = await client.graphql<MyRepositoriesData>(
      MY_REPOSITORIES_QUERY,
      { cursor, pageSize },
      { operationName: OPERATIONS.myRepositories, signal: options.signal }
    )
    viewerLogin = res.data.viewer?.login ?? viewerLogin
    const connection = res.data.viewer?.repositories
    return {
      items: compact(connection?.nodes)
        .map(mapRepository)
        .filter(
          (r): r is RepositoryRecord =>
            r !== null &&
            r.viewerPermission !== null &&
            WRITE_PERMISSIONS.includes(r.viewerPermission)
        ),
      pageInfo: connection?.pageInfo,
      orgRestrictions: res.orgRestrictions
    }
  })
  return { ...result, viewerLogin }
}

interface StarredData {
  viewer?: {
    starredRepositories?: {
      pageInfo?: RawPageInfo | null
      edges?: ({ starredAt?: string | null; node?: RawRepository | null } | null)[] | null
    } | null
  } | null
}

/** 스타한 저장소 (spec §4.7), 스타한 시각 포함 */
export async function collectStarredRepositories(
  options: PagedOptions = {}
): Promise<ListResult<StarredRepositoryRecord>> {
  const client = resolveClient(options)
  return collectPages(options, async (cursor, pageSize) => {
    const res = await client.graphql<StarredData>(
      STARRED_REPOSITORIES_QUERY,
      { cursor, pageSize },
      { operationName: OPERATIONS.starredRepositories, signal: options.signal }
    )
    const connection = res.data.viewer?.starredRepositories
    const items: StarredRepositoryRecord[] = []
    for (const edge of compact(connection?.edges)) {
      const repository = mapRepository(edge.node)
      if (repository && edge.starredAt) items.push({ repository, starredAt: edge.starredAt })
    }
    return { items, pageInfo: connection?.pageInfo, orgRestrictions: res.orgRestrictions }
  })
}

export { collectPages }
