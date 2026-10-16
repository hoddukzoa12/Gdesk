import type { DatabaseSync } from 'node:sqlite'
import { CONTRIBUTION_LEVELS } from '@shared/domain/home-activity'
import type { ContributionLevel, RecentCommit } from '@shared/domain/home-activity'
import { withTransaction } from '../db/transaction'
import { num, str, strOrNull } from './rows'

/** Home 활동 영역 캐시: 기여 달력·커밋 기여 수, 최근 커밋 (spec 5.4·5.5) */

export interface ContributionDayRecord {
  /** `YYYY-MM-DD` */
  date: string
  count: number
  level: ContributionLevel
}

export interface ContributionsRecord {
  totalCommitContributions: number
  /** 오래된 날 → 오늘 순 */
  days: ContributionDayRecord[]
}

function levelOf(value: string): ContributionLevel {
  return CONTRIBUTION_LEVELS.find((l) => l === value) ?? 'NONE'
}

/** 기여 달력을 통째로 바꾼다 */
export function replaceContributions(db: DatabaseSync, record: ContributionsRecord): void {
  withTransaction(db, () => {
    db.exec('DELETE FROM cache_contribution_days')
    const insert = db.prepare(
      'INSERT OR REPLACE INTO cache_contribution_days (date, count, level) VALUES (?, ?, ?)'
    )
    for (const day of record.days) insert.run(day.date, day.count, day.level)
    db.prepare(
      'INSERT OR REPLACE INTO cache_contribution_summary (id, total_commit_contributions) VALUES (1, ?)'
    ).run(record.totalCommitContributions)
  })
}

/** 받은 기여 달력. 아직 받지 않았으면 null */
export function getContributions(db: DatabaseSync): ContributionsRecord | null {
  const summary = db
    .prepare('SELECT total_commit_contributions FROM cache_contribution_summary WHERE id = 1')
    .get()
  if (summary === undefined) return null
  return {
    totalCommitContributions: num(summary, 'total_commit_contributions'),
    days: db
      .prepare('SELECT date, count, level FROM cache_contribution_days ORDER BY date')
      .all()
      .map((row) => ({
        date: str(row, 'date'),
        count: num(row, 'count'),
        level: levelOf(str(row, 'level'))
      }))
  }
}

/** 최근 커밋을 통째로 바꾼다(주어진 순서 = 작성 시각 최신 순) */
export function replaceRecentCommits(db: DatabaseSync, items: readonly RecentCommit[]): void {
  withTransaction(db, () => {
    db.exec('DELETE FROM cache_recent_commits')
    const insert = db.prepare(
      `INSERT INTO cache_recent_commits
         (position, repo_full_name, sha, message,
          author_avatar_url, author_login, author_date, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    items.forEach((c, i) =>
      insert.run(
        i,
        c.repoFullName,
        c.sha,
        c.message,
        c.authorAvatarUrl,
        c.authorLogin,
        c.authorDate,
        c.url
      )
    )
  })
}

export function listRecentCommits(
  db: DatabaseSync,
  options: { limit?: number } = {}
): RecentCommit[] {
  const limit =
    options.limit !== undefined && options.limit > 0 ? ` LIMIT ${Math.floor(options.limit)}` : ''
  return db
    .prepare(`SELECT * FROM cache_recent_commits ORDER BY position${limit}`)
    .all()
    .map((row) => ({
      repoFullName: str(row, 'repo_full_name'),
      sha: str(row, 'sha'),
      message: str(row, 'message'),
      authorAvatarUrl: strOrNull(row, 'author_avatar_url'),
      authorLogin: strOrNull(row, 'author_login'),
      authorDate: strOrNull(row, 'author_date'),
      url: str(row, 'url')
    }))
}
