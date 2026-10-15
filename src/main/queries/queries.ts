import type { DatabaseSync } from 'node:sqlite'
import type { IssueRow } from '@shared/domain/issue'
import type { ListPage } from '@shared/domain/list'
import type { OrgRestrictionNotice } from '@shared/domain/org'
import type { PullRequestRow } from '@shared/domain/pr'
import { ISSUES_TABS, PULLS_TABS } from '@shared/domain/queries'
import type {
  HomeSummary,
  InboxQueryResult,
  IssuesTab,
  PullsTab,
  RepoDetailQueryResult,
  RepositoriesQueryResult,
  SidebarPinnedItem,
  SidebarQueryResult,
  SidebarRepoItem
} from '@shared/domain/queries'
import type { RepoSort, RepositorySummary } from '@shared/domain/repo'
import {
  getHomeSummary,
  getRepository,
  getRepositoryDetail,
  getSidebarCounts,
  isNotificationListComplete,
  listAssignedIssues,
  listIncomingIssues,
  listIncomingPullRequests,
  listMyIssues,
  listMyPullRequests,
  listMyRepositories,
  listMyRepositoryOwners,
  listNotifications,
  listOrgRestrictions,
  listReviewRequests,
  listStarredRepositories
} from '../cache'
import { assertRepoId, listPins } from '../pins/pins.service'

/**
 * 화면 조회 (`query:*`). 캐시만 읽는다. 화면에서 온 값은 여기서 검사한다.
 * 로그인 상태·상세 추적 집합처럼 DB 밖의 값은 QueryContext 로 받는다.
 */
export interface QueryContext {
  /** 상세 추적 저장소 ID(고정 + 보고 있는 저장소) */
  trackedRepoIds(): readonly number[]
  /** 알림을 받을 수 있는 로그인인가 */
  inboxAvailable(): boolean
  /** 동쪽이 양수인 분 단위 시간대(한국 540). 기본 이 컴퓨터의 시간대 */
  utcOffsetMinutes?(): number
  now?(): number
}

/** 이 컴퓨터의 시간대(분, 동쪽 양수). Date#getTimezoneOffset 은 부호가 반대다 */
export function localUtcOffsetMinutes(at: Date = new Date()): number {
  return -at.getTimezoneOffset()
}

/** 사이드바 "Your repositories" 기본 개수 */
export const SIDEBAR_REPOSITORY_LIMIT = 8

const REPO_SORTS: readonly RepoSort[] = ['pushed', 'name', 'stars']

function offset(ctx: QueryContext): number {
  return ctx.utcOffsetMinutes?.() ?? localUtcOffsetMinutes()
}

function oneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${name}: ${String(value)}`)
  }
  return value as T
}

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`Invalid ${name}`)
  return value
}

function optionalBoolean(name: string, value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`Invalid ${name}`)
  return value
}

export function queryHome(db: DatabaseSync, ctx: QueryContext): HomeSummary {
  return getHomeSummary(db, ctx.trackedRepoIds(), {
    now: ctx.now?.(),
    utcOffsetMinutes: offset(ctx)
  })
}

export function queryInbox(
  db: DatabaseSync,
  req: { unreadOnly?: boolean; repoId?: number; reason?: string } | undefined,
  ctx: QueryContext
): InboxQueryResult {
  const request = req ?? {}
  const repoId = request.repoId ?? undefined
  if (repoId !== undefined) assertRepoId(repoId)
  const reason = optionalString('reason', request.reason)
  return {
    items: listNotifications(db, {
      unreadOnly: optionalBoolean('unreadOnly', request.unreadOnly) ?? false,
      repoId,
      reason: reason === '' ? undefined : reason
    }),
    complete: isNotificationListComplete(db),
    inboxAvailable: ctx.inboxAvailable()
  }
}

export function queryPulls(
  db: DatabaseSync,
  req: { tab: PullsTab } | undefined
): ListPage<PullRequestRow> {
  const tab = oneOf('tab', req?.tab, PULLS_TABS)
  return tab === 'incoming' ? listIncomingPullRequests(db) : listMyPullRequests(db)
}

export function queryReviews(db: DatabaseSync): ListPage<PullRequestRow> {
  return listReviewRequests(db)
}

export function queryIssues(
  db: DatabaseSync,
  req: { tab: IssuesTab } | undefined
): ListPage<IssueRow> {
  const tab = oneOf('tab', req?.tab, ISSUES_TABS)
  if (tab === 'incoming') return listIncomingIssues(db)
  return tab === 'assigned' ? listAssignedIssues(db) : listMyIssues(db)
}

export function queryStarred(
  db: DatabaseSync,
  req: { search?: string } | undefined
): RepositorySummary[] {
  return listStarredRepositories(db, { search: optionalString('search', req?.search) })
}

export function queryRepositories(
  db: DatabaseSync,
  req:
    | {
        includeForks?: boolean
        includeArchived?: boolean
        owner?: string
        sort?: RepoSort
        search?: string
      }
    | undefined
): RepositoriesQueryResult {
  const request = req ?? {}
  return {
    items: listMyRepositories(db, {
      includeForks: optionalBoolean('includeForks', request.includeForks),
      includeArchived: optionalBoolean('includeArchived', request.includeArchived),
      owner: optionalString('owner', request.owner) || undefined,
      sort: request.sort === undefined ? 'pushed' : oneOf('sort', request.sort, REPO_SORTS),
      search: optionalString('search', request.search)
    }),
    owners: listMyRepositoryOwners(db)
  }
}

export function queryRepoDetail(
  db: DatabaseSync,
  req: { repoId: number } | undefined,
  ctx: QueryContext
): RepoDetailQueryResult | null {
  const repoId = req?.repoId
  assertRepoId(repoId)
  const detail = getRepositoryDetail(db, repoId, {
    now: ctx.now?.(),
    utcOffsetMinutes: offset(ctx)
  })
  if (detail === null) return null
  return {
    detail,
    accessStatus: detail.repository.accessStatus,
    pinned: listPins(db).some((p) => p.repoId === repoId)
  }
}

function sidebarItem(repoId: number, repo: RepositorySummary | null): SidebarRepoItem {
  // 접근 불가로만 알려진 저장소는 이름이 빈 자리 행이다
  const known = repo !== null && repo.fullName !== ''
  return {
    repoId,
    owner: known ? repo.owner : null,
    name: known ? repo.name : null,
    fullName: known ? repo.fullName : null,
    stargazerCount: known ? repo.stargazerCount : null,
    openPullRequestCount: known ? repo.openPullRequestCount : null,
    accessStatus: repo === null ? 'unavailable' : repo.accessStatus
  }
}

export function querySidebar(
  db: DatabaseSync,
  options: { yourRepositoriesLimit?: number } = {}
): SidebarQueryResult {
  const pinned: SidebarPinnedItem[] = listPins(db).map((pin) => {
    const repo = getRepository(db, pin.repoId)
    return { ...sidebarItem(pin.repoId, repo), position: pin.position, cached: repo !== null }
  })
  return {
    counts: getSidebarCounts(db),
    pinned,
    yourRepositories: listMyRepositories(db, {
      sort: 'pushed',
      limit: options.yourRepositoriesLimit ?? SIDEBAR_REPOSITORY_LIMIT
    }).map((repo) => sidebarItem(repo.id, repo))
  }
}

export function queryOrgRestrictions(db: DatabaseSync): OrgRestrictionNotice[] {
  return listOrgRestrictions(db)
}
