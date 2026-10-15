import type { CiStatus } from './ci'
import type { IssueRow } from './issue'
import type { NotificationRow } from './notification'
import type { PullRequestRow } from './pr'

/** 실패한 CI 카드 (a): 상세 추적 저장소의 기본 브랜치 최신 커밋 CI 가 실패 */
export interface FailedCiRepo {
  repoId: number
  repoFullName: string
  defaultBranch: string | null
  sha: string
  message: string
  url: string
  ciStatus: CiStatus
  committedAt: string | null
}

/** 실패한 CI 카드: (a) 상세 추적 저장소 + (b) 내가 올린 열린 PR */
export interface FailedCiCard {
  repos: FailedCiRepo[]
  pullRequests: PullRequestRow[]
}

export type ContributionItem =
  { kind: 'pull_request'; item: PullRequestRow } | { kind: 'issue'; item: IssueRow }

export interface StarChangeItem {
  repoId: number
  repoFullName: string
  /** 창(기본 7일) 동안 늘어난 스타 수 */
  gained: number
  truncated: boolean
}

export interface CountedList<T> {
  count: number
  /** 최근 순 일부 */
  items: T[]
}

/** Home 카드 다섯 종류 (spec §4.2) */
export interface HomeSummary {
  reviewRequests: CountedList<PullRequestRow>
  unreadNotifications: CountedList<NotificationRow>
  failedCi: FailedCiCard
  unansweredContributions: CountedList<ContributionItem>
  starChanges: { windowDays: number; items: StarChangeItem[] }
}

/** 사이드바 수치 (spec §4.1) */
export interface SidebarCounts {
  unreadNotifications: number
  incomingPullRequests: number
  reviewRequests: number
}
