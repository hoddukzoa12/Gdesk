import type { DatabaseSync } from 'node:sqlite'
import type { LocalSearchResult } from '@shared/domain/search'
import { toIssueRow } from './issues'
import { toPullRequestRow } from './pull-requests'
import { toRepositorySummary } from './repositories'
import { likePattern } from './rows'

/**
 * 빠른 검색창의 앱 안 항목 (spec §4.12). 저장된 정보만 쓰므로 오프라인에서도 동작한다.
 * - 저장소: 이름·설명. 내 저장소 → 최근 푸시 순
 * - PR·이슈: 제목·저장소 이름, 또는 `#번호`
 */
export function searchLocal(
  db: DatabaseSync,
  text: string,
  options: { limit?: number } = {}
): LocalSearchResult {
  const query = text.trim()
  const limit = Math.max(1, Math.floor(options.limit ?? 10))
  if (query === '') return { repositories: [], pullRequests: [], issues: [] }

  const numberMatch = /^#(\d+)$/.exec(query)
  if (numberMatch) {
    const n = Number(numberMatch[1])
    return {
      repositories: [],
      pullRequests: db
        .prepare(
          `SELECT * FROM cache_pull_requests WHERE number = ? ORDER BY updated_at DESC LIMIT ${limit}`
        )
        .all(n)
        .map(toPullRequestRow),
      issues: db
        .prepare(
          `SELECT * FROM cache_issues WHERE number = ? ORDER BY updated_at DESC LIMIT ${limit}`
        )
        .all(n)
        .map(toIssueRow)
    }
  }

  const like = likePattern(query)
  return {
    repositories: db
      .prepare(
        `SELECT * FROM cache_repositories
         WHERE full_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
         ORDER BY is_mine DESC, viewer_has_starred DESC, pushed_at DESC LIMIT ${limit}`
      )
      .all(like, like)
      .map(toRepositorySummary),
    pullRequests: db
      .prepare(
        `SELECT * FROM cache_pull_requests
         WHERE title LIKE ? ESCAPE '\\' OR repo_full_name LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ${limit}`
      )
      .all(like, like)
      .map(toPullRequestRow),
    issues: db
      .prepare(
        `SELECT * FROM cache_issues
         WHERE title LIKE ? ESCAPE '\\' OR repo_full_name LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ${limit}`
      )
      .all(like, like)
      .map(toIssueRow)
  }
}
