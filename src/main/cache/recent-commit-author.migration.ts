import type { Migration } from '../db/migrations'

/**
 * 최근 커밋 작성자 (Home 최근 커밋 아바타의 대체 글자용).
 * - cache_recent_commits.author_login: 커밋 검색의 author.login, GitHub 계정과 연결되지 않은 커밋은
 *   commit.author.name. 이전 버전이 저장한 행은 NULL 이고 다음 갱신 때 채워진다.
 */
export const migration: Migration = {
  id: '0105_recent_commit_author',
  up(db) {
    db.exec('ALTER TABLE cache_recent_commits ADD COLUMN author_login TEXT')
  }
}
