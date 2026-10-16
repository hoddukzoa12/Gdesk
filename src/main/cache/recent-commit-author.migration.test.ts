import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectMigrations, runMigrations } from '../db/migrations'
import { listRecentCommits, replaceRecentCommits } from './home-activity'

describe('0105_recent_commit_author', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
  })
  afterEach(() => db.close())

  it('이전 버전이 저장한 최근 커밋은 작성자 없이(null) 그대로 읽힌다', () => {
    const all = collectMigrations()
    runMigrations(
      db,
      all.filter((m) => m.id < '0105')
    )
    db.prepare(
      `INSERT INTO cache_recent_commits
         (position, repo_full_name, sha, message, author_avatar_url, author_date, url)
       VALUES (0, 'me/app', 'a1', 'fix', NULL, NULL, 'https://github.com/me/app/commit/a1')`
    ).run()
    runMigrations(db, all)
    expect(listRecentCommits(db)).toEqual([
      {
        repoFullName: 'me/app',
        sha: 'a1',
        message: 'fix',
        authorAvatarUrl: null,
        authorLogin: null,
        authorDate: null,
        url: 'https://github.com/me/app/commit/a1'
      }
    ])
  })

  it('작성자 로그인을 저장하고 읽는다', () => {
    runMigrations(db, collectMigrations())
    replaceRecentCommits(db, [
      {
        repoFullName: 'me/app',
        sha: 'a1',
        message: 'fix',
        authorAvatarUrl: null,
        authorLogin: 'me',
        authorDate: null,
        url: 'u'
      }
    ])
    expect(listRecentCommits(db)[0]?.authorLogin).toBe('me')
  })
})
