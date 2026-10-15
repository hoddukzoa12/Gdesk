import type { CiStatus } from './ci'
import type { ActorSummary } from './actor'

/** 저장소 접근 상태 (spec §7). 삭제·권한 상실·접근 불가면 unavailable */
export type RepoAccessStatus = 'available' | 'unavailable'

export const REPO_ACCESS_STATUSES: readonly RepoAccessStatus[] = ['available', 'unavailable']

/** GitHub `RepositoryPermission` */
export type ViewerPermission = 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ'

/** 내 저장소 집합에 들어가는 권한(push·maintain·admin, spec §3) */
export const WRITE_PERMISSIONS: readonly ViewerPermission[] = ['ADMIN', 'MAINTAIN', 'WRITE']

export type RepoOwnerType = 'User' | 'Organization'

/** 저장소 머리글·목록 행. 식별자는 GitHub 숫자 저장소 ID */
export interface RepositorySummary {
  id: number
  owner: string
  ownerType: RepoOwnerType
  ownerAvatarUrl: string | null
  name: string
  /** `owner/name` */
  fullName: string
  /** GitHub 웹 주소 */
  url: string
  private: boolean
  fork: boolean
  archived: boolean
  description: string | null
  homepageUrl: string | null
  primaryLanguage: string | null
  primaryLanguageColor: string | null
  defaultBranch: string | null
  /** SPDX ID(없으면 이름) */
  license: string | null
  stargazerCount: number
  forkCount: number
  openPullRequestCount: number
  openIssueCount: number
  /** ISO 8601 */
  pushedAt: string | null
  updatedAt: string | null
  topics: string[]
  viewerPermission: ViewerPermission | null
  /** 내 저장소 집합(소유 + 쓰기 권한)에 속하는가 */
  isMine: boolean
  viewerHasStarred: boolean
  /** 스타 목록에서 받은 스타 시각(ISO). 모르면 null */
  starredAt: string | null
  accessStatus: RepoAccessStatus
}

export type RepoSort = 'pushed' | 'name' | 'stars'

export interface RepoListOptions {
  /** 포크 표시(기본 false) */
  includeForks?: boolean
  /** 보관 저장소 표시(기본 false) */
  includeArchived?: boolean
  /** 소유자 login 으로 거르기 */
  owner?: string
  /** 기본 'pushed'(최근 푸시 순) */
  sort?: RepoSort
  /** 이름·설명 검색어 */
  search?: string
  limit?: number
}

export interface CommitSummary {
  sha: string
  shortSha: string
  /** 첫 줄 */
  message: string
  author: ActorSummary | null
  /** GitHub 사용자와 연결되지 않은 커밋의 이름 */
  authorName: string | null
  committedAt: string | null
  url: string
  ciStatus: CiStatus
}

export interface ReleaseSummary {
  id: string
  tagName: string
  name: string | null
  publishedAt: string | null
  createdAt: string
  isPrerelease: boolean
  isDraft: boolean
  isLatest: boolean
  url: string
}

export interface LanguageShare {
  name: string
  color: string | null
  bytes: number
  /** 0..1 */
  ratio: number
}

export interface ContributorSummary {
  login: string
  avatarUrl: string | null
  url: string | null
  contributions: number
}
