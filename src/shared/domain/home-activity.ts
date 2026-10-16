import type { PrReviewStatus, PrState, PullRequestRow } from './pr'
import type { RepoAccessStatus } from './repo'

/**
 * Home 활동 영역(인사말 아래 새 영역 다섯 개: 수치, 고정 저장소, 기여 달력, 최근 커밋, 내 PR)의 타입.
 * 값은 모두 캐시에서 읽는다. 아직 받지 않은 값은 null 이고 화면은 "—" 를 보여 준다.
 */

/** 수치 줄 (spec 5.2). 받기 전에는 null */
export interface HomeStats {
  /** 최근 12개월 커밋 기여 수(`contributionsCollection.totalCommitContributions` 그대로) */
  commits: number | null
  /** 내 저장소 집합 중 포크·보관을 뺀 수(Repositories 화면 기본 필터와 같음) */
  repositories: number | null
  /** 내가 올린 열린 PR 의 GitHub 전체 수 */
  openPullRequests: number | null
  /** 기여가 1 이상인 날이 이어진 일수. 달력의 마지막 날이 오늘 */
  streak: number | null
}

/** 고정 저장소 카드 표시 상한(조정 가능) */
export const HOME_PINNED_REPO_LIMIT = 4

/**
 * 고정 저장소 카드 (spec 5.3). 고정 순서. 캐시에 행이 없는 고정(`cached: false`)도 자리를 지키며
 * 이름·수치는 null, 접근 상태는 unavailable 이다(사이드바와 같은 규칙).
 */
export interface PinnedRepoCard {
  repoId: number
  /** 캐시에 이 저장소 행이 있는가 */
  cached: boolean
  owner: string | null
  name: string | null
  fullName: string | null
  /** GitHub 웹 주소 */
  url: string | null
  description: string | null
  primaryLanguage: string | null
  primaryLanguageColor: string | null
  stargazerCount: number | null
  forkCount: number | null
  ownerAvatarUrl: string | null
  accessStatus: RepoAccessStatus
}

/** GitHub `ContributionLevel` */
export type ContributionLevel =
  'NONE' | 'FIRST_QUARTILE' | 'SECOND_QUARTILE' | 'THIRD_QUARTILE' | 'FOURTH_QUARTILE'

export const CONTRIBUTION_LEVELS: readonly ContributionLevel[] = [
  'NONE',
  'FIRST_QUARTILE',
  'SECOND_QUARTILE',
  'THIRD_QUARTILE',
  'FOURTH_QUARTILE'
]

/** 기여 달력 하루 */
export interface ContributionDay {
  /** `YYYY-MM-DD` (GitHub 가 준 달력 날짜) */
  date: string
  count: number
  level: ContributionLevel
  /**
   * 요일. 0 = 일요일 … 6 = 토요일(GitHub·JS 와 같음). 월–일 행으로 놓으려면 `(weekday + 6) % 7`
   * (0 = 월요일)을 행 번호로 쓴다.
   */
  weekday: number
}

/**
 * 기여 달력 (spec 5.4). 최근 12개월.
 * `days` 는 오래된 날 → 오늘 순으로 펼친 목록이다. GitHub 주는 일요일에 시작하므로 첫 날은 보통 일요일이고,
 * 마지막 날이 오늘이다(마지막 주는 오늘에서 끝나 7일보다 짧을 수 있다). 화면은 `weekday` 로 행을 정한다.
 */
export interface ContributionCalendar {
  days: ContributionDay[]
}

/** 최근 커밋 표시 개수(조정 가능) */
export const HOME_RECENT_COMMIT_LIMIT = 5

/** 최근 커밋 한 줄 (spec 5.5). 커밋 검색은 기본 브랜치만 보고 몇 분 늦을 수 있다 */
export interface RecentCommit {
  /** `owner/name` */
  repoFullName: string
  sha: string
  /** 메시지 첫 줄 */
  message: string
  authorAvatarUrl: string | null
  /** 작성자 로그인. GitHub 계정과 연결되지 않은 커밋은 커밋의 작성자 이름, 둘 다 없으면 null */
  authorLogin: string | null
  /** 작성 시각(ISO 8601) */
  authorDate: string | null
  /** GitHub 커밋 페이지 */
  url: string
}

export interface RecentCommitsSection {
  /** 작성 시각 최신 순 */
  items: RecentCommit[]
  /** 한 번이라도 받았는가(false 면 화면은 "—"/불러오는 중) */
  fetched: boolean
  /** GitHub 커밋 검색 "모두 보기". 로그인 이름을 모르면 null */
  viewAllUrl: string | null
}

/** 내 PR 표시 상태 (spec 5.6) */
export type PrDisplayStatus =
  'draft' | 'changes_requested' | 'approved' | 'review_required' | 'open'

export const PR_DISPLAY_STATUSES: readonly PrDisplayStatus[] = [
  'draft',
  'changes_requested',
  'approved',
  'review_required',
  'open'
]

/** 내 PR 표시 개수(조정 가능) */
export const HOME_MY_PULL_REQUEST_LIMIT = 5

export interface MyPullRequestItem extends PullRequestRow {
  displayStatus: PrDisplayStatus
}

export interface MyPullRequestsSection {
  /** GitHub 전체 수(목록 상한에 잘리지 않음) */
  totalCount: number
  /** 근거 목록을 다 받았는가 */
  complete: boolean
  /** 최근 갱신 순 최대 5개 */
  items: MyPullRequestItem[]
}

/** query:home 이 기존 카드 다섯 종류에 더해 주는 활동 영역 */
export interface HomeActivity {
  stats: HomeStats
  pinnedRepos: PinnedRepoCard[]
  /** 아직 받지 않았으면 null */
  contributions: ContributionCalendar | null
  recentCommits: RecentCommitsSection
  myPullRequests: MyPullRequestsSection
}

/** PR 표시 상태. 처음 맞는 규칙: 초안 → 변경 요청 → 승인 → 리뷰 필요 → 열림 */
export function prDisplayStatus(pr: {
  state: PrState
  reviewStatus: PrReviewStatus
}): PrDisplayStatus {
  if (pr.state === 'draft') return 'draft'
  switch (pr.reviewStatus) {
    case 'changes_requested':
      return 'changes_requested'
    case 'approved':
      return 'approved'
    case 'review_required':
      return 'review_required'
    default:
      return 'open'
  }
}

/** 최근 커밋 "모두 보기": 작성자 커밋 검색, 작성 시각 최신 순 */
export function recentCommitsViewAllUrl(login: string): string {
  return `https://github.com/search?q=author:${encodeURIComponent(login)}&type=commits&s=author-date&o=desc`
}
