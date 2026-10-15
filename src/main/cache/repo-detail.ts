import type { DatabaseSync } from 'node:sqlite'
import type { CiStatus } from '@shared/domain/ci'
import { CI_STATUSES } from '@shared/domain/ci'
import type { RepositoryDetail } from '@shared/domain/repo-detail'
import type {
  CommitSummary,
  ContributorSummary,
  LanguageShare,
  ReleaseSummary
} from '@shared/domain/repo'
import type { StarGrowth } from '@shared/domain/stats'
import { STAR_DETAIL_WINDOW_DAYS } from '@shared/domain/stats'
import { summarizeCi } from '../domain/ci'
import type { TrackedRepoHead } from '../domain/failed-ci'
import { dailyStarCounts } from '../domain/stars'
import { withTransaction } from '../db/transaction'
import { listRepoIssues, replaceRepoIssues } from './issues'
import {
  listMyPullRequestsInRepo,
  listRepoPullRequests,
  replaceRepoPullRequests
} from './pull-requests'
import { getRepositories, getRepository, upsertRepositories } from './repositories'
import { bool, jsonValue, num, numOrNull, placeholders, str, strOrNull, sqlBool } from './rows'
import type { Row } from './rows'
import type { RepositoryDetailRecord } from './types'

/**
 * 저장소 상세 캐시 (spec §4.9). 상세 추적 저장소만 저장한다.
 * 저장할 때마다 그 저장소의 커밋·릴리스·언어·기여자·스타 시각·열린 PR·이슈를 통째로 바꾼다.
 */

function ciOf(value: string): CiStatus {
  return CI_STATUSES.find((s) => s === value) ?? 'none'
}

/** 상세 수집 결과를 저장한다. 머리글도 갱신하며 접근 상태는 available 이 된다 */
export function saveRepositoryDetail(
  db: DatabaseSync,
  detail: RepositoryDetailRecord,
  now: number = Date.now()
): void {
  const repoId = detail.repository.id
  withTransaction(db, () => {
    upsertRepositories(db, [detail.repository], now)
    // 상세의 상한(기본 30)이 목록 수집(기본 50)보다 작아도 잘린 목록은 합치므로 행이 줄지 않는다
    replaceRepoPullRequests(db, repoId, detail.openPullRequests, {
      totalCount: detail.repository.openPullRequestCount
    })
    replaceRepoIssues(db, repoId, detail.openIssues, {
      totalCount: detail.repository.openIssueCount
    })

    db.prepare('DELETE FROM cache_commits WHERE repo_id = ?').run(repoId)
    const commit = db.prepare(
      `INSERT INTO cache_commits (repo_id, position, sha, message, author_login, author_avatar_url,
         author_is_bot, author_name, committed_at, url, ci_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    detail.commits.forEach((c, i) =>
      commit.run(
        repoId,
        i,
        c.sha,
        c.message,
        c.author?.login ?? null,
        c.author?.avatarUrl ?? null,
        sqlBool(c.author?.isBot ?? false),
        c.authorName,
        c.committedAt,
        c.url,
        c.ciStatus
      )
    )

    db.prepare('DELETE FROM cache_releases WHERE repo_id = ?').run(repoId)
    const release = db.prepare(
      `INSERT INTO cache_releases (repo_id, position, id, tag_name, name, published_at, created_at,
         is_prerelease, is_draft, is_latest, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    detail.releases.forEach((r, i) =>
      release.run(
        repoId,
        i,
        r.id,
        r.tagName,
        r.name,
        r.publishedAt,
        r.createdAt,
        sqlBool(r.isPrerelease),
        sqlBool(r.isDraft),
        sqlBool(r.isLatest),
        r.url
      )
    )

    db.prepare('DELETE FROM cache_languages WHERE repo_id = ?').run(repoId)
    const language = db.prepare(
      'INSERT OR REPLACE INTO cache_languages (repo_id, name, color, bytes) VALUES (?, ?, ?, ?)'
    )
    for (const l of detail.languages) language.run(repoId, l.name, l.color, l.bytes)

    db.prepare('DELETE FROM cache_contributors WHERE repo_id = ?').run(repoId)
    const contributor = db.prepare(
      `INSERT INTO cache_contributors (repo_id, position, login, avatar_url, url, contributions)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    detail.contributors.forEach((c, i) =>
      contributor.run(repoId, i, c.login, c.avatarUrl, c.url, c.contributions)
    )

    db.prepare('DELETE FROM cache_stargazers WHERE repo_id = ?').run(repoId)
    const star = db.prepare(
      'INSERT INTO cache_stargazers (repo_id, starred_at, login) VALUES (?, ?, ?)'
    )
    for (const s of detail.stargazers) star.run(repoId, s.starredAt, s.login)

    db.prepare(
      `INSERT OR REPLACE INTO cache_repo_details (repo_id, synced_at, release_count, latest_release,
         contributor_count, stars_since, stars_truncated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      repoId,
      now,
      detail.releaseCount,
      detail.latestRelease ? JSON.stringify(detail.latestRelease) : null,
      detail.contributorCount,
      detail.starsSince,
      sqlBool(detail.starsTruncated)
    )
  })
}

function listCommits(db: DatabaseSync, repoId: number): CommitSummary[] {
  return db
    .prepare('SELECT * FROM cache_commits WHERE repo_id = ? ORDER BY position')
    .all(repoId)
    .map((row) => {
      const login = strOrNull(row, 'author_login')
      return {
        sha: str(row, 'sha'),
        shortSha: str(row, 'sha').slice(0, 7),
        message: str(row, 'message'),
        author:
          login === null
            ? null
            : {
                login,
                avatarUrl: strOrNull(row, 'author_avatar_url'),
                isBot: bool(row, 'author_is_bot')
              },
        authorName: strOrNull(row, 'author_name'),
        committedAt: strOrNull(row, 'committed_at'),
        url: str(row, 'url'),
        ciStatus: ciOf(str(row, 'ci_status'))
      }
    })
}

function toRelease(row: Row): ReleaseSummary {
  return {
    id: str(row, 'id'),
    tagName: str(row, 'tag_name'),
    name: strOrNull(row, 'name'),
    publishedAt: strOrNull(row, 'published_at'),
    createdAt: str(row, 'created_at'),
    isPrerelease: bool(row, 'is_prerelease'),
    isDraft: bool(row, 'is_draft'),
    isLatest: bool(row, 'is_latest'),
    url: str(row, 'url')
  }
}

function listLanguages(db: DatabaseSync, repoId: number): LanguageShare[] {
  const rows = db
    .prepare(
      'SELECT name, color, bytes FROM cache_languages WHERE repo_id = ? ORDER BY bytes DESC, name'
    )
    .all(repoId)
  const total = rows.reduce((n, r) => n + num(r, 'bytes'), 0)
  return rows.map((r) => ({
    name: str(r, 'name'),
    color: strOrNull(r, 'color'),
    bytes: num(r, 'bytes'),
    ratio: total > 0 ? num(r, 'bytes') / total : 0
  }))
}

function listContributors(db: DatabaseSync, repoId: number): ContributorSummary[] {
  return db
    .prepare('SELECT * FROM cache_contributors WHERE repo_id = ? ORDER BY position')
    .all(repoId)
    .map((r) => ({
      login: str(r, 'login'),
      avatarUrl: strOrNull(r, 'avatar_url'),
      url: strOrNull(r, 'url'),
      contributions: num(r, 'contributions')
    }))
}

/** 저장소의 스타 시각(ISO) */
export function listStarTimestamps(db: DatabaseSync, repoId: number): string[] {
  return db
    .prepare('SELECT starred_at FROM cache_stargazers WHERE repo_id = ? ORDER BY starred_at')
    .all(repoId)
    .map((r) => str(r, 'starred_at'))
}

function starsTruncated(db: DatabaseSync, repoId: number): boolean {
  const row = db
    .prepare('SELECT stars_truncated FROM cache_repo_details WHERE repo_id = ?')
    .get(repoId)
  return row !== undefined && bool(row, 'stars_truncated')
}

export interface StarWindowReadOptions {
  now?: number
  days?: number
  utcOffsetMinutes?: number
}

/** 저장된 스타 시각으로 스타 증가를 계산한다 */
export function getStarGrowth(
  db: DatabaseSync,
  repoId: number,
  options: StarWindowReadOptions = {}
): StarGrowth {
  const daily = dailyStarCounts(listStarTimestamps(db, repoId), {
    now: options.now ?? Date.now(),
    days: options.days ?? STAR_DETAIL_WINDOW_DAYS,
    utcOffsetMinutes: options.utcOffsetMinutes
  })
  return {
    repoId,
    daily,
    total: daily.reduce((n, d) => n + d.count, 0),
    truncated: starsTruncated(db, repoId)
  }
}

export interface RepositoryDetailReadOptions extends StarWindowReadOptions {
  /** 열린 PR·이슈 목록 최대 개수(기본 30) */
  limit?: number
}

/** 저장소 상세 화면 데이터. 캐시에 저장소가 없으면 null */
export function getRepositoryDetail(
  db: DatabaseSync,
  repoId: number,
  options: RepositoryDetailReadOptions = {}
): RepositoryDetail | null {
  const repository = getRepository(db, repoId)
  if (repository === null) return null
  const meta = db.prepare('SELECT * FROM cache_repo_details WHERE repo_id = ?').get(repoId)
  const limit = options.limit ?? 30
  const commits = listCommits(db, repoId)
  const prs = listRepoPullRequests(db, repoId, { limit })
  const issues = listRepoIssues(db, repoId, { limit })
  return {
    repository,
    detailSyncedAt: meta === undefined ? null : num(meta, 'synced_at'),
    openPullRequestCount: repository.openPullRequestCount,
    openPullRequests: prs.items,
    openPullRequestsComplete: prs.complete && prs.items.length >= prs.totalCount,
    myPullRequests: listMyPullRequestsInRepo(db, repoId),
    openIssueCount: repository.openIssueCount,
    openIssues: issues.items,
    openIssuesComplete: issues.complete && issues.items.length >= issues.totalCount,
    commits,
    latestCommitCi: summarizeCi(commits.map((c) => c.ciStatus)),
    latestRelease:
      meta === undefined ? null : jsonValue<ReleaseSummary | null>(meta, 'latest_release', null),
    releaseCount: meta === undefined ? 0 : num(meta, 'release_count'),
    releases: db
      .prepare('SELECT * FROM cache_releases WHERE repo_id = ? ORDER BY position')
      .all(repoId)
      .map(toRelease),
    languages: listLanguages(db, repoId),
    contributors: listContributors(db, repoId),
    contributorCount: meta === undefined ? null : numOrNull(meta, 'contributor_count'),
    stars: getStarGrowth(db, repoId, options)
  }
}

/** 실패한 CI 카드 (a) 재료: 상세 추적 저장소의 기본 브랜치 최신 커밋. 캐시에 없는 ID 는 빠진다 */
export function listTrackedRepoHeads(
  db: DatabaseSync,
  repoIds: readonly number[]
): TrackedRepoHead[] {
  const repos = getRepositories(db, repoIds)
  if (repos.length === 0) return []
  const commits = new Map(
    db
      .prepare(
        `SELECT repo_id, sha, message, url, committed_at, ci_status FROM cache_commits
         WHERE position = 0 AND repo_id IN (${placeholders(repos.length)})`
      )
      .all(...repos.map((r) => r.id))
      .map((row) => [num(row, 'repo_id'), row])
  )
  return repos.map((repo) => {
    const row = commits.get(repo.id)
    return {
      repoId: repo.id,
      repoFullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      latestCommit:
        row === undefined
          ? null
          : {
              sha: str(row, 'sha'),
              message: str(row, 'message'),
              url: str(row, 'url'),
              committedAt: strOrNull(row, 'committed_at'),
              ciStatus: ciOf(str(row, 'ci_status'))
            }
    }
  })
}
