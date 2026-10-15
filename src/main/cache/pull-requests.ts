import type { DatabaseSync } from 'node:sqlite'
import type { CiStatus } from '@shared/domain/ci'
import type { PrReviewStatus, PullRequestRow } from '@shared/domain/pr'
import { CI_STATUSES } from '@shared/domain/ci'
import { PR_REVIEW_STATUSES } from '@shared/domain/pr'
import { withTransaction } from '../db/transaction'
import { bool, num, str, strOrNull, sqlBool } from './rows'
import type { Row } from './rows'
import { replaceScope, repoScope } from './scopes'
import type { PullRequestRecord } from './types'

/** 저장소와 무관한 PR 목록 */
export type PullRequestScope = 'mine' | 'review_requested'

const TABLES = {
  items: 'cache_pull_requests',
  scopes: 'cache_pull_request_scopes',
  idColumn: 'pr_id'
}

const COLUMNS = `p.id, p.repo_id, p.repo_full_name, p.number, p.title, p.url, p.author_login,
  p.author_avatar_url, p.author_is_bot, p.author_association, p.viewer_is_author, p.state,
  p.review_status, p.ci_status, p.comment_count, p.has_write_response, p.created_at, p.updated_at`

const ORDER = 'ORDER BY p.updated_at DESC, p.id'

function ciOf(value: string): CiStatus {
  return CI_STATUSES.find((s) => s === value) ?? 'none'
}

function reviewOf(value: string): PrReviewStatus {
  return PR_REVIEW_STATUSES.find((s) => s === value) ?? 'none'
}

export function toPullRequestRow(row: Row): PullRequestRow {
  return {
    id: str(row, 'id'),
    repoId: num(row, 'repo_id'),
    repoFullName: str(row, 'repo_full_name'),
    number: num(row, 'number'),
    title: str(row, 'title'),
    url: str(row, 'url'),
    author: {
      login: str(row, 'author_login'),
      avatarUrl: strOrNull(row, 'author_avatar_url'),
      isBot: bool(row, 'author_is_bot')
    },
    state: str(row, 'state') === 'draft' ? 'draft' : 'open',
    reviewStatus: reviewOf(str(row, 'review_status')),
    ciStatus: ciOf(str(row, 'ci_status')),
    commentCount: num(row, 'comment_count'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at')
  }
}

export function toPullRequestRecord(row: Row): PullRequestRecord {
  return {
    ...toPullRequestRow(row),
    authorAssociation: strOrNull(row, 'author_association'),
    viewerIsAuthor: bool(row, 'viewer_is_author'),
    hasWriteHolderResponse: bool(row, 'has_write_response')
  }
}

function upsert(db: DatabaseSync, prs: readonly PullRequestRecord[]): void {
  const stmt = db.prepare(
    `INSERT INTO cache_pull_requests (id, repo_id, repo_full_name, number, title, url, author_login,
       author_avatar_url, author_is_bot, author_association, viewer_is_author, state, review_status,
       ci_status, comment_count, has_write_response, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       repo_id = excluded.repo_id, repo_full_name = excluded.repo_full_name,
       number = excluded.number, title = excluded.title, url = excluded.url,
       author_login = excluded.author_login, author_avatar_url = excluded.author_avatar_url,
       author_is_bot = excluded.author_is_bot, author_association = excluded.author_association,
       viewer_is_author = excluded.viewer_is_author, state = excluded.state,
       review_status = excluded.review_status, ci_status = excluded.ci_status,
       comment_count = excluded.comment_count, has_write_response = excluded.has_write_response,
       created_at = excluded.created_at, updated_at = excluded.updated_at`
  )
  for (const p of prs) {
    stmt.run(
      p.id,
      p.repoId,
      p.repoFullName,
      p.number,
      p.title,
      p.url,
      p.author.login,
      p.author.avatarUrl,
      sqlBool(p.author.isBot),
      p.authorAssociation,
      sqlBool(p.viewerIsAuthor),
      p.state,
      p.reviewStatus,
      p.ciStatus,
      p.commentCount,
      sqlBool(p.hasWriteHolderResponse),
      p.createdAt,
      p.updatedAt
    )
  }
}

function replace(db: DatabaseSync, scope: string, prs: readonly PullRequestRecord[]): void {
  withTransaction(db, () => {
    upsert(db, prs)
    replaceScope(
      db,
      TABLES,
      scope,
      prs.map((p) => p.id)
    )
  })
}

/** 내가 올린 PR·리뷰 요청 목록 전체를 바꾼다 */
export function replacePullRequests(
  db: DatabaseSync,
  scope: PullRequestScope,
  prs: readonly PullRequestRecord[]
): void {
  replace(db, scope, prs)
}

/** 저장소 하나의 열린 PR 전체를 바꾼다(들어온 PR·상세 화면의 근거) */
export function replaceRepoPullRequests(
  db: DatabaseSync,
  repoId: number,
  prs: readonly PullRequestRecord[]
): void {
  replace(db, repoScope(repoId), prs)
}

function listScope(db: DatabaseSync, scope: string, limit?: number): Row[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM cache_pull_requests p
       JOIN cache_pull_request_scopes s ON s.pr_id = p.id AND s.scope = ?
       ${ORDER}${limitClause(limit)}`
    )
    .all(scope)
}

export function limitClause(limit: number | undefined): string {
  return limit !== undefined && limit > 0 ? ` LIMIT ${Math.floor(limit)}` : ''
}

/** 들어온 PR 의 조건: 내 저장소 집합의 열린 PR(저장소 범위) 중 내가 쓰지 않은 것 */
const INCOMING_FROM = `FROM cache_pull_requests p
  JOIN cache_repositories r ON r.id = p.repo_id AND r.is_mine = 1
  WHERE p.viewer_is_author = 0 AND EXISTS (
    SELECT 1 FROM cache_pull_request_scopes s WHERE s.pr_id = p.id AND s.scope = 'repo:' || p.repo_id)`

/** 들어온 PR (spec §4.4), 최근 갱신 순 */
export function listIncomingPullRequests(
  db: DatabaseSync,
  options: { limit?: number } = {}
): PullRequestRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} ${INCOMING_FROM} ${ORDER}${limitClause(options.limit)}`)
    .all()
    .map(toPullRequestRow)
}

/** "응답 없는 새 기여" 판정용: 들어온 PR 의 판정 재료 포함 */
export function listIncomingPullRequestRecords(db: DatabaseSync): PullRequestRecord[] {
  return db.prepare(`SELECT ${COLUMNS} ${INCOMING_FROM} ${ORDER}`).all().map(toPullRequestRecord)
}

export function countIncomingPullRequests(db: DatabaseSync): number {
  return num(db.prepare(`SELECT COUNT(*) AS n ${INCOMING_FROM}`).get() ?? {}, 'n')
}

/** 내가 올린 열린 PR (spec §4.4), 저장소 무관 */
export function listMyPullRequests(
  db: DatabaseSync,
  options: { limit?: number } = {}
): PullRequestRow[] {
  return listScope(db, 'mine', options.limit).map(toPullRequestRow)
}

/** 나 또는 내 팀에 리뷰가 요청된 열린 PR (spec §4.5) */
export function listReviewRequests(
  db: DatabaseSync,
  options: { limit?: number } = {}
): PullRequestRow[] {
  return listScope(db, 'review_requested', options.limit).map(toPullRequestRow)
}

export function countReviewRequests(db: DatabaseSync): number {
  return num(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM cache_pull_request_scopes WHERE scope = 'review_requested'"
      )
      .get() ?? {},
    'n'
  )
}

/** 저장소 상세의 열린 PR 목록 */
export function listRepoPullRequests(
  db: DatabaseSync,
  repoId: number,
  options: { limit?: number } = {}
): PullRequestRow[] {
  return listScope(db, repoScope(repoId), options.limit).map(toPullRequestRow)
}

/** 이 저장소에서 내가 올린 열린 PR (어느 목록에서 받았든) */
export function listMyPullRequestsInRepo(db: DatabaseSync, repoId: number): PullRequestRow[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM cache_pull_requests p
       WHERE p.repo_id = ? AND p.viewer_is_author = 1 ${ORDER}`
    )
    .all(repoId)
    .map(toPullRequestRow)
}
