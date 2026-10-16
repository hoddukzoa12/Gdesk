import type { HomeStats } from '@shared/domain/home-activity'

/** Home 수치 줄 계산 (spec 5.2). 순수 함수 */

/**
 * 연속 기여 일수. 달력의 마지막 칸이 오늘이다(날짜 문자열은 보지 않고 칸 순서만 본다).
 * 오늘이 1 이상이면 오늘부터, 오늘이 0 이면 어제부터 거꾸로 1 이상인 날을 센다. 어제도 0 이면 0.
 */
export function contributionStreak(days: readonly { count: number }[]): number {
  let end = days.length - 1
  if (end < 0) return 0
  if ((days[end]?.count ?? 0) < 1) end--
  let streak = 0
  for (let i = end; i >= 0 && (days[i]?.count ?? 0) >= 1; i--) streak++
  return streak
}

export interface HomeStatsInput {
  /** 받은 기여 달력. 아직 없으면 null */
  contributions: { totalCommitContributions: number; days: readonly { count: number }[] } | null
  /** 포크·보관을 뺀 내 저장소 수. 아직 받지 않았으면 null */
  repositoryCount: number | null
  /** 내가 올린 열린 PR 의 GitHub 전체 수. 아직 받지 않았으면 null */
  openPullRequestTotal: number | null
}

export function composeHomeStats(input: HomeStatsInput): HomeStats {
  const c = input.contributions
  return {
    commits: c === null ? null : c.totalCommitContributions,
    repositories: input.repositoryCount,
    openPullRequests: input.openPullRequestTotal,
    streak: c === null ? null : contributionStreak(c.days)
  }
}
