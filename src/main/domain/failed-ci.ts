import type { CiStatus } from '@shared/domain/ci'
import type { FailedCiCard, FailedCiRepo } from '@shared/domain/home'
import type { PullRequestRow } from '@shared/domain/pr'

/** 상세 추적 저장소의 기본 브랜치 머리 정보 */
export interface TrackedRepoHead {
  repoId: number
  repoFullName: string
  defaultBranch: string | null
  latestCommit: {
    sha: string
    message: string
    url: string
    committedAt: string | null
    ciStatus: CiStatus
  } | null
}

/**
 * 실패한 CI 카드 (spec §4.2).
 * (a) 상세 추적 저장소(고정 + 보고 있는 저장소, 호출자가 ID 를 넘김) 중 기본 브랜치 최신 커밋 CI 가 failing 인 것.
 *     추적 ID 순서를 지키고 중복은 한 번만.
 * (b) 내가 올린 열린 PR 중 최신 커밋 CI 가 failing 인 것(저장소 무관). 최근 갱신 순.
 */
export function composeFailedCi(
  trackedRepoIds: readonly number[],
  heads: readonly TrackedRepoHead[],
  myOpenPullRequests: readonly PullRequestRow[]
): FailedCiCard {
  const byId = new Map(heads.map((h) => [h.repoId, h]))
  const seen = new Set<number>()
  const repos: FailedCiRepo[] = []
  for (const id of trackedRepoIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const head = byId.get(id)
    const commit = head?.latestCommit
    if (!head || !commit || commit.ciStatus !== 'failing') continue
    repos.push({
      repoId: head.repoId,
      repoFullName: head.repoFullName,
      defaultBranch: head.defaultBranch,
      sha: commit.sha,
      message: commit.message,
      url: commit.url,
      ciStatus: commit.ciStatus,
      committedAt: commit.committedAt
    })
  }
  const pullRequests = myOpenPullRequests
    .filter((pr) => pr.ciStatus === 'failing')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return { repos, pullRequests }
}
