import type { Migration } from '../db/migrations'

/**
 * 이슈 목록·상세 (spec §6.1·§6.2). 로그아웃·계정 변경 때 clearCache() 가 비운다(CACHE_TABLES).
 * - cache_issues.assignees: 이슈 행의 담당자(JSON, labels 와 같은 방식)
 * - cache_repositories.has_issues_enabled: 이슈를 켠 저장소인가. 이전 행은 켜진 것으로 둔다
 * - cache_issue_details: 이슈 상세(저장소 ID + 번호). 수집 결과를 JSON 으로 통째로 둔다
 * 나를 언급한 이슈 목록은 기존 cache_issue_scopes 의 'mentioned' 범위를 쓴다(표가 따로 없다).
 */
export const migration: Migration = {
  id: '0103_issue_detail',
  up(db) {
    db.exec(`
      ALTER TABLE cache_issues ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE cache_repositories ADD COLUMN has_issues_enabled INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE cache_issue_details (
        repo_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (repo_id, number)
      );
      CREATE INDEX cache_issue_details_fetched ON cache_issue_details (fetched_at);
    `)
  }
}
