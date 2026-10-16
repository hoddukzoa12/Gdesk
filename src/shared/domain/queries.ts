import type { HomeSummary, SidebarCounts } from './home'
import type { HomeActivity } from './home-activity'
import type { IssueRow } from './issue'
import type { ListPage } from './list'
import type { NotificationRow } from './notification'
import type { RepositoryDetail } from './repo-detail'
import type { RepoAccessStatus, RepoOwnerType, RepositorySummary } from './repo'

/** 화면 조회(`query:*`) 응답. 모두 캐시에서 읽은 평범한 값이다 */

export type { HomeSummary }

/**
 * Home 화면(`query:home`). 기존 카드 다섯 종류(HomeSummary)에 활동 영역 다섯 개(수치, 고정 저장소,
 * 기여 달력, 최근 커밋, 내 PR)를 더한다. 인사말은 세션에서 읽으므로 여기에 없다.
 */
export interface HomeQueryResult extends HomeSummary, HomeActivity {}

/** Inbox 화면 */
export interface InboxQueryResult {
  items: NotificationRow[]
  /** 알림을 다 받았는가(false 면 GitHub 에 더 있을 수 있다) */
  complete: boolean
  /** false 면 알림을 받을 수 없는 로그인(세분화 토큰·notifications 권한 없음) */
  inboxAvailable: boolean
}

export type PullsTab = 'incoming' | 'mine'
export const PULLS_TABS: readonly PullsTab[] = ['incoming', 'mine']

/** 이슈 목록 탭 (spec §6.1): 들어온 이슈 · 나에게 할당 · 나를 언급 · 내가 올린 이슈 */
export type IssuesTab = 'incoming' | 'assigned' | 'mentioned' | 'mine'
export const ISSUES_TABS: readonly IssuesTab[] = ['incoming', 'assigned', 'mentioned', 'mine']

/** 탭마다 GitHub 전체 열린 이슈 수(목록 상한에 잘리지 않음) */
export type IssueTabCounts = Record<IssuesTab, number>

/** Issues 화면(`query:issues`): 요청한 탭의 목록 + 네 탭의 수 */
export interface IssuesQueryResult {
  page: ListPage<IssueRow>
  counts: IssueTabCounts
}

/** Repositories 화면의 소유자 필터 항목 */
export interface RepoOwnerOption {
  login: string
  type: RepoOwnerType
  /** 내 저장소 집합에서 이 소유자의 저장소 수 */
  count: number
}

export interface RepositoriesQueryResult {
  items: RepositorySummary[]
  owners: RepoOwnerOption[]
}

/** 저장소 상세 화면. 캐시에 저장소가 없으면 조회 결과가 null */
export interface RepoDetailQueryResult {
  detail: RepositoryDetail
  accessStatus: RepoAccessStatus
  pinned: boolean
}

/** 사이드바의 저장소 한 줄 */
export interface SidebarRepoItem {
  repoId: number
  /** 모르면 null(캐시에 없거나 접근 불가로만 알려진 저장소) */
  owner: string | null
  name: string | null
  fullName: string | null
  stargazerCount: number | null
  openPullRequestCount: number | null
  accessStatus: RepoAccessStatus
}

/** 고정한 저장소 줄. 캐시에 없는 고정도 빠지지 않는다 */
export interface SidebarPinnedItem extends SidebarRepoItem {
  position: number
  /** 캐시에 이 저장소 행이 있는가. false 면 아직 받지 못했거나 지워진 저장소 */
  cached: boolean
}

/** 사이드바 (spec §4.1) */
export interface SidebarQueryResult {
  counts: SidebarCounts
  /** 사용자가 정한 순서 */
  pinned: SidebarPinnedItem[]
  /** 최근 푸시 순 일부(기본 8개) */
  yourRepositories: SidebarRepoItem[]
}
