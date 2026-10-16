import type { Migration } from '../db/migrations'

/**
 * Home 활동 영역 캐시 (spec 5.8). 로그아웃·계정 변경 때 clearCache() 가 비운다(CACHE_TABLES).
 * - cache_contribution_days: 최근 12개월 기여 달력(하루 한 행). 받을 때마다 통째로 바꾼다.
 * - cache_contribution_summary: 같은 달력의 커밋 기여 수. 한 행뿐이다.
 * - cache_recent_commits: 커밋 검색으로 받은 내 최근 커밋(작성 시각 최신 순 position).
 */
export const migration: Migration = {
  id: '0102_home_activity',
  up(db) {
    db.exec(`
      CREATE TABLE cache_contribution_days (
        date TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        level TEXT NOT NULL
      );

      CREATE TABLE cache_contribution_summary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_commit_contributions INTEGER NOT NULL
      );

      CREATE TABLE cache_recent_commits (
        position INTEGER PRIMARY KEY,
        repo_full_name TEXT NOT NULL,
        sha TEXT NOT NULL,
        message TEXT NOT NULL,
        author_avatar_url TEXT,
        author_date TEXT,
        url TEXT NOT NULL
      );
    `)
  }
}
