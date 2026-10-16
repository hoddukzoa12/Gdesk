import type { ActorSummary } from '@shared/domain/actor'
import type { IssueRow } from '@shared/domain/issue'
import type { IssueDetail } from '@shared/domain/issue-detail'
import type { NotificationRow } from '@shared/domain/notification'
import type { PullRequestRow } from '@shared/domain/pr'
import type {
  CommitSummary,
  ContributorSummary,
  ReleaseSummary,
  RepoOwnerType,
  ViewerPermission
} from '@shared/domain/repo'

/**
 * 수집기 → 캐시 쓰기 함수로 넘기는 값. 화면용 행(shared)에 판정용 내부 필드를 더한 것이다.
 */

/** 저장소 머리글 (목록·상세 수집 공통). isMine·starredAt·accessStatus 는 쓰기 함수가 정한다 */
export interface RepositoryRecord {
  id: number
  nodeId: string | null
  owner: string
  ownerType: RepoOwnerType
  ownerAvatarUrl: string | null
  name: string
  fullName: string
  url: string
  private: boolean
  fork: boolean
  archived: boolean
  description: string | null
  homepageUrl: string | null
  primaryLanguage: string | null
  primaryLanguageColor: string | null
  defaultBranch: string | null
  license: string | null
  stargazerCount: number
  forkCount: number
  openPullRequestCount: number
  openIssueCount: number
  pushedAt: string | null
  updatedAt: string | null
  topics: string[]
  viewerPermission: ViewerPermission | null
  viewerHasStarred: boolean
  /** 이슈를 켠 저장소인가(응답에 없으면 true) */
  hasIssuesEnabled: boolean
}

/** "응답 없는 새 기여" 판정 재료 */
export interface ContributionFields {
  /** 작성자와 저장소의 관계(OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE …) */
  authorAssociation: string | null
  /** 내가 작성했는가 */
  viewerIsAuthor: boolean
  /** 쓰기 권한자의 코멘트·리뷰가 있는가 */
  hasWriteHolderResponse: boolean
}

export type PullRequestRecord = PullRequestRow & ContributionFields
export type IssueRecord = IssueRow & ContributionFields

export interface NotificationRecord extends NotificationRow {
  /** subject 의 API 주소(원본) */
  subjectApiUrl: string | null
}

export interface StarredRepositoryRecord {
  repository: RepositoryRecord
  starredAt: string
}

export type CommitRecord = CommitSummary
export type ReleaseRecord = ReleaseSummary
export type ContributorRecord = ContributorSummary

export interface LanguageRecord {
  name: string
  color: string | null
  bytes: number
}

/** 저장소 상세 수집 결과 (상세 추적 저장소만) */
export interface RepositoryDetailRecord {
  repository: RepositoryRecord
  /** 열린 PR(최근 갱신 순, 일부) */
  openPullRequests: PullRequestRecord[]
  /** 열린 이슈(최근 갱신 순, 일부) */
  openIssues: IssueRecord[]
  /** 기본 브랜치 최근 커밋, 최신 → 과거 */
  commits: CommitRecord[]
  latestRelease: ReleaseRecord | null
  releaseCount: number
  releases: ReleaseRecord[]
  languages: LanguageRecord[]
  contributors: ContributorRecord[]
  contributorCount: number | null
  /** 받은 구간의 스타 시각(ISO) */
  stargazers: { starredAt: string; login: string | null }[]
  /** 스타 시각을 이 시각(ISO) 이후로만 받았다 */
  starsSince: string | null
  /** 스타 시각을 다 받지 못했다(아주 큰 저장소 등) */
  starsTruncated: boolean
}

/** 이슈 상세 수집 결과. 코멘트 가능 여부·받은 시각은 읽을 때 붙인다 */
export type IssueDetailRecord = Omit<IssueDetail, 'viewerCanComment' | 'fetchedAt'>

export type { ActorSummary }
