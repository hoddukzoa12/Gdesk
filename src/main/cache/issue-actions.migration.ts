import type { Migration } from '../db/migrations'

/**
 * 이슈 쓰기 동작 (spec §6.3). 로그아웃·계정 변경 때 clearCache() 가 비운다(CACHE_TABLES).
 * - cache_created_issues: 앱에서 만든 이슈(목록 행 JSON)와 만든 시각(epoch ms). GitHub 검색 반영이 늦어도
 *   "내 이슈" 목록을 검색으로 다시 쓸 때 유예 시간 동안 남기려고 둔다. 검색에 나오거나 유예가 지나면 지운다.
 */
export const migration: Migration = {
  id: '0104_issue_actions',
  up(db) {
    db.exec(`
      CREATE TABLE cache_created_issues (
        issue_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }
}
