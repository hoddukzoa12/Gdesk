import type { DatabaseSync } from 'node:sqlite'
import {
  HOME_MY_PULL_REQUEST_LIMIT,
  HOME_PINNED_REPO_LIMIT,
  prDisplayStatus,
  recentCommitsViewAllUrl
} from '@shared/domain/home-activity'
import type {
  ContributionCalendar,
  HomeActivity,
  MyPullRequestsSection,
  PinnedRepoCard,
  RecentCommitsSection
} from '@shared/domain/home-activity'
import type { IssueRow } from '@shared/domain/issue'
import type { ListPage } from '@shared/domain/list'
import type { OrgRestrictionNotice } from '@shared/domain/org'
import type { PullRequestRow } from '@shared/domain/pr'
import { ISSUES_TABS, PULLS_TABS } from '@shared/domain/queries'
import type {
  HomeQueryResult,
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
  getContributions,
  getHomeSummary,
  getRepositories,
  getRepository,
  getSyncState,
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
  listRecentCommits,
  listReviewRequests,
  listStarredRepositories
} from '../cache'
import { composeHomeStats } from '../domain/home-activity'
import { SYNC_SCOPES } from '../github/collectors/refresh'
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
  /** 로그인한 사용자의 GitHub login(최근 커밋 "모두 보기" 주소). 모르면 null */
  viewerLogin?(): string | null
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

function synced(db: DatabaseSync, scope: string): boolean {
  return getSyncState(db, scope).lastSyncedAt !== null
}

/** 고정 순서로 최대 limit 개. 캐시에 없는 고정도 자리를 지킨다(사이드바와 같은 규칙) */
function pinnedRepoCards(db: DatabaseSync, limit: number): PinnedRepoCard[] {
  const ids = listPins(db)
    .map((p) => p.repoId)
    .slice(0, limit)
  const repos = new Map(getRepositories(db, ids).map((r) => [r.id, r]))
  return ids.map((repoId) => {
    const repo = repos.get(repoId) ?? null
    // 접근 불가로만 알려진 저장소는 이름이 빈 자리 행이다
    const known = repo !== null && repo.fullName !== ''
    return {
      repoId,
      cached: repo !== null,
      owner: known ? repo.owner : null,
      name: known ? repo.name : null,
      fullName: known ? repo.fullName : null,
      url: known ? repo.url : null,
      description: known ? repo.description : null,
      primaryLanguage: known ? repo.primaryLanguage : null,
      primaryLanguageColor: known ? repo.primaryLanguageColor : null,
      stargazerCount: known ? repo.stargazerCount : null,
      forkCount: known ? repo.forkCount : null,
      ownerAvatarUrl: known ? repo.ownerAvatarUrl : null,
      accessStatus: repo === null ? 'unavailable' : repo.accessStatus
    }
  })
}

/** Home 활동 영역 다섯 개. 아직 받지 않은 값은 null(화면은 "—") */
export function getHomeActivity(db: DatabaseSync, ctx: QueryContext): HomeActivity {
  const contributions = getContributions(db)
  const mine = listMyPullRequests(db, { limit: HOME_MY_PULL_REQUEST_LIMIT })
  const minePulled = synced(db, SYNC_SCOPES.myPullRequests)
  // 포크·보관 제외는 Repositories 화면의 기본 필터와 같다
  const repositoryCount = synced(db, SYNC_SCOPES.repositories)
    ? listMyRepositories(db).length
    : null

  const calendar: ContributionCalendar | null =
    contributions === null
      ? null
      : {
          days: contributions.days.map((d) => ({
            ...d,
            weekday: new Date(`${d.date}T00:00:00Z`).getUTCDay()
          }))
        }
  const login = ctx.viewerLogin?.() ?? null
  const recentCommits: RecentCommitsSection = {
    items: listRecentCommits(db),
    fetched: synced(db, SYNC_SCOPES.recentCommits),
    viewAllUrl: login ? recentCommitsViewAllUrl(login) : null
  }
  const myPullRequests: MyPullRequestsSection = {
    totalCount: mine.totalCount,
    complete: mine.complete,
    items: mine.items.map((pr) => ({ ...pr, displayStatus: prDisplayStatus(pr) }))
  }
  return {
    stats: composeHomeStats({
      contributions,
      repositoryCount,
      openPullRequestTotal: minePulled ? mine.totalCount : null
    }),
    pinnedRepos: pinnedRepoCards(db, HOME_PINNED_REPO_LIMIT),
    contributions: calendar,
    recentCommits,
    myPullRequests
  }
}

export function queryHome(db: DatabaseSync, ctx: QueryContext): HomeQueryResult {
  return {
    ...getHomeSummary(db, ctx.trackedRepoIds(), {
      now: ctx.now?.(),
      utcOffsetMinutes: offset(ctx)
    }),
    ...getHomeActivity(db, ctx)
  }
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
