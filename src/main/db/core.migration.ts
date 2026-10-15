import type { Migration } from './migrations'

/** 핵심 테이블: 고정, 로컬 연결, 설정, 계정 정보. GitHub 캐시 테이블은 캐시 기능이 따로 추가한다. */
export const migration: Migration = {
  id: '0001_core',
  up(db) {
    db.exec(`
      CREATE TABLE pins (
        repo_id INTEGER PRIMARY KEY,
        position INTEGER NOT NULL
      );

      CREATE TABLE local_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL,
        last_used_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing')),
        UNIQUE (repo_id, path_key)
      );
      CREATE INDEX local_links_repo ON local_links (repo_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE account_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }
}
