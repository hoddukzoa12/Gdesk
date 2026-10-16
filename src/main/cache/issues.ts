import type { DatabaseSync } from 'node:sqlite'
import type { ActorSummary } from '@shared/domain/actor'
import type { IssueLabel, IssueRow } from '@shared/domain/issue'
import type { ListPage } from '@shared/domain/list'
import type { IssueTabCounts } from '@shared/domain/queries'
import { withTransaction } from '../db/transaction'
import { limitClause } from './pull-requests'
import type { ListWriteOptions } from './pull-requests'
import { bool, jsonValue, num, str, strOrNull, sqlBool } from './rows'
import type { Row } from './rows'
import { incomingSummary, repoScope, scopeMeta, writeScope } from './scopes'
import type { ScopeTables, ScopeWriteMode } from './scopes'
import type { IssueRecord } from './types'

/**
 * 이슈 캐시. PR 은 별도 표라 이슈 목록에 섞이지 않는다(수집기도 PR 을 걸러 낸다).
 */
export type IssueScope = 'mine' | 'assigned' | 'mentioned'

const TABLES: ScopeTables = {
  kind: 'issue',
  items: 'cache_issues',
  scopes: 'cache_issue_scopes',
  idColumn: 'issue_id',
  repoCountColumn: 'open_issue_count'
}

const COLUMNS = `i.id, i.repo_id, i.repo_full_name, i.number, i.title, i.url, i.author_login,
  i.author_avatar_url, i.author_is_bot, i.author_association, i.viewer_is_author, i.labels,
  i.assignees, i.comment_count, i.has_write_response, i.created_at, i.updated_at`

const ORDER = 'ORDER BY i.updated_at DESC, i.id'

export function toIssueRow(row: Row): IssueRow {
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
    labels: jsonValue<IssueLabel[]>(row, 'labels', []),
    assignees: jsonValue<ActorSummary[]>(row, 'assignees', []),
    commentCount: num(row, 'comment_count'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at')
  }
}

export function toIssueRecord(row: Row): IssueRecord {
  return {
    ...toIssueRow(row),
    authorAssociation: strOrNull(row, 'author_association'),
    viewerIsAuthor: bool(row, 'viewer_is_author'),
    hasWriteHolderResponse: bool(row, 'has_write_response')
  }
}

function upsert(db: DatabaseSync, issues: readonly IssueRecord[]): void {
  const stmt = db.prepare(
    `INSERT INTO cache_issues (id, repo_id, repo_full_name, number, title, url, author_login,
       author_avatar_url, author_is_bot, author_association, viewer_is_author, labels, assignees,
       comment_count, has_write_response, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       repo_id = excluded.repo_id, repo_full_name = excluded.repo_full_name,
       number = excluded.number, title = excluded.title, url = excluded.url,
       author_login = excluded.author_login, author_avatar_url = excluded.author_avatar_url,
       author_is_bot = excluded.author_is_bot, author_association = excluded.author_association,
       viewer_is_author = excluded.viewer_is_author, labels = excluded.labels,
       assignees = excluded.assignees, comment_count = excluded.comment_count,
       has_write_response = excluded.has_write_response,
       created_at = excluded.created_at, updated_at = excluded.updated_at`
  )
  for (const i of issues) {
    stmt.run(
      i.id,
      i.repoId,
      i.repoFullName,
      i.number,
      i.title,
      i.url,
      i.author.login,
      i.author.avatarUrl,
      sqlBool(i.author.isBot),
      i.authorAssociation,
      sqlBool(i.viewerIsAuthor),
      JSON.stringify(i.labels),
      JSON.stringify(i.assignees),
      i.commentCount,
      sqlBool(i.hasWriteHolderResponse),
      i.createdAt,
      i.updatedAt
    )
  }
}

function write(
  db: DatabaseSync,
  scope: string,
  issues: readonly IssueRecord[],
  options: ListWriteOptions,
  mode: ScopeWriteMode
): void {
  withTransaction(db, () => {
    upsert(db, issues)
    writeScope(db, TABLES, scope, issues, options.totalCount, mode)
  })
}

/** 나에게 할당된·나를 언급한·내가 올린 이슈 목록 전체를 바꾼다. totalCount 는 검색 결과 총수 */
export function replaceIssues(
  db: DatabaseSync,
  scope: IssueScope,
  issues: readonly IssueRecord[],
  options: ListWriteOptions = {}
): void {
  write(db, scope, issues, options, 'replace')
}

/**
 * 이슈 한 개를 목록에 더한다(새로 만든 이슈를 검색 반영 전에 "내 이슈"에 바로 보이게).
 * 목록의 다른 항목은 그대로 두고, 새로 들어가면 목록 전체 수(메타)를 1 늘린다. 트랜잭션 안에서 불러도 된다.
 */
export function addIssueToScope(db: DatabaseSync, scope: IssueScope, issue: IssueRecord): void {
  withTransaction(db, () => {
    upsert(db, [issue])
    const added = db
      .prepare('INSERT OR IGNORE INTO cache_issue_scopes (scope, issue_id) VALUES (?, ?)')
      .run(scope, issue.id)
    if (Number(added.changes) > 0) {
      db.prepare('UPDATE cache_list_meta SET total_count = total_count + 1 WHERE scope = ?').run(
        `${TABLES.kind}:${scope}`
      )
    }
  })
}

/** 저장소 하나의 열린 이슈를 쓴다. 잘린 목록이면 기존 행을 줄이지 않고 합친다(replaceRepoPullRequests 와 같음) */
export function replaceRepoIssues(
  db: DatabaseSync,
  repoId: number,
  issues: readonly IssueRecord[],
  options: ListWriteOptions = {}
): void {
  write(db, repoScope(repoId), issues, options, 'window')
}

function scopePage(db: DatabaseSync, scope: string, limit?: number): ListPage<IssueRow> {
  const items = db
    .prepare(
      `SELECT ${COLUMNS} FROM cache_issues i
       JOIN cache_issue_scopes s ON s.issue_id = i.id AND s.scope = ?
       ${ORDER}${limitClause(limit)}`
    )
    .all(scope)
    .map(toIssueRow)
  return { items, ...scopeMeta(db, TABLES, scope) }
}

const INCOMING_FROM = `FROM cache_issues i
  JOIN cache_repositories r ON r.id = i.repo_id AND r.is_mine = 1
  WHERE i.viewer_is_author = 0 AND EXISTS (
    SELECT 1 FROM cache_issue_scopes s WHERE s.issue_id = i.id AND s.scope = 'repo:' || i.repo_id)`

/** 들어온 이슈 (spec §4.6): 내 저장소 집합의 열린 이슈 중 내가 쓰지 않은 것. totalCount 는 저장소별 전체 수 기준 */
export function listIncomingIssues(
  db: DatabaseSync,
  options: { limit?: number } = {}
): ListPage<IssueRow> {
  return {
    items: db
      .prepare(`SELECT ${COLUMNS} ${INCOMING_FROM} ${ORDER}${limitClause(options.limit)}`)
      .all()
      .map(toIssueRow),
    ...incomingSummary(db, TABLES)
  }
}

/** 들어온 이슈 근거를 다 받았는가 */
export function isIncomingIssuesComplete(db: DatabaseSync): boolean {
  return incomingSummary(db, TABLES).complete
}

/** "응답 없는 새 기여" 판정용 */
export function listIncomingIssueRecords(db: DatabaseSync): IssueRecord[] {
  return db.prepare(`SELECT ${COLUMNS} ${INCOMING_FROM} ${ORDER}`).all().map(toIssueRecord)
}

/** 나에게 할당된 열린 이슈 */
export function listAssignedIssues(
  db: DatabaseSync,
  options: { limit?: number } = {}
): ListPage<IssueRow> {
  return scopePage(db, 'assigned', options.limit)
}

/** 나를 언급한 열린 이슈 (mentions:@me) */
export function listMentionedIssues(
  db: DatabaseSync,
  options: { limit?: number } = {}
): ListPage<IssueRow> {
  return scopePage(db, 'mentioned', options.limit)
}

/** Issues 탭 네 개의 전체 열린 이슈 수(GitHub 기준, 목록 상한에 잘리지 않음) */
export function getIssueTabCounts(db: DatabaseSync): IssueTabCounts {
  return {
    incoming: incomingSummary(db, TABLES).totalCount,
    assigned: scopeMeta(db, TABLES, 'assigned').totalCount,
    mentioned: scopeMeta(db, TABLES, 'mentioned').totalCount,
    mine: scopeMeta(db, TABLES, 'mine').totalCount
  }
}

/** 내가 올린 열린 이슈 */
export function listMyIssues(
  db: DatabaseSync,
  options: { limit?: number } = {}
): ListPage<IssueRow> {
  return scopePage(db, 'mine', options.limit)
}

/** 저장소 상세의 열린 이슈 */
export function listRepoIssues(
  db: DatabaseSync,
  repoId: number,
  options: { limit?: number } = {}
): ListPage<IssueRow> {
  return scopePage(db, repoScope(repoId), options.limit)
}
