import type { IssueRow } from './issue'
import type { PullRequestRow } from './pr'
import type { RepositorySummary } from './repo'

/** 빠른 검색창의 앱 안 항목 결과 (spec §4.12). 저장된 정보만 쓰므로 오프라인에서도 동작한다 */
export interface LocalSearchResult {
  repositories: RepositorySummary[]
  pullRequests: PullRequestRow[]
  issues: IssueRow[]
}
