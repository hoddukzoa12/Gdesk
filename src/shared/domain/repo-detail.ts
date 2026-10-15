import type { CiStatus } from './ci'
import type { IssueRow } from './issue'
import type { PullRequestRow } from './pr'
import type {
  CommitSummary,
  ContributorSummary,
  LanguageShare,
  ReleaseSummary,
  RepositorySummary
} from './repo'
import type { StarGrowth } from './stats'

/** 저장소 상세 화면 (spec §4.9). 상세 수집 전이면 header 외의 목록은 비어 있고 detailSyncedAt 이 null */
export interface RepositoryDetail {
  repository: RepositorySummary
  /** 상세 정보를 마지막으로 받은 시각(epoch ms). 아직 없으면 null */
  detailSyncedAt: number | null
  openPullRequestCount: number
  /** 최근 갱신 순 일부 */
  openPullRequests: PullRequestRow[]
  /** 열린 PR 을 다 받았는가(false 면 GitHub 에서 더 보기) */
  openPullRequestsComplete: boolean
  /** 이 저장소에서 내가 올린 열린 PR */
  myPullRequests: PullRequestRow[]
  openIssueCount: number
  openIssues: IssueRow[]
  /** 열린 이슈를 다 받았는가 */
  openIssuesComplete: boolean
  /** 기본 브랜치 최근 커밋(최신 → 과거, 최대 7개) */
  commits: CommitSummary[]
  /** 기본 브랜치 최신 커밋의 CI. 커밋이 없으면 none */
  latestCommitCi: CiStatus
  latestRelease: ReleaseSummary | null
  releaseCount: number
  releases: ReleaseSummary[]
  /** 크기 순 */
  languages: LanguageShare[]
  contributors: ContributorSummary[]
  /** 기여자 총 인원. 알 수 없으면 null */
  contributorCount: number | null
  /** 최근 30일 스타 증가 */
  stars: StarGrowth
}
