import type { DatabaseSync } from 'node:sqlite'
import { canCommentOnIssue } from '@shared/domain/issue-detail'
import type { IssueDetail } from '@shared/domain/issue-detail'
import { withTransaction } from '../db/transaction'
import { num, str } from './rows'
import type { IssueDetailRecord } from './types'

/**
 * 이슈 상세 캐시 (spec §6.2). 키는 (숫자 저장소 ID, 이슈 번호). 받은 결과를 JSON 으로 통째로 둔다.
 * 오프라인이면 마지막으로 받은 상세를 그대로 보여 준다. 오래 보지 않은 상세부터 지워 개수를 제한한다.
 */

/** 남겨 둘 상세 수(조정 가능). 넘으면 가장 오래전에 받은 것부터 지운다 */
export const ISSUE_DETAIL_CACHE_LIMIT = 200

/** 상세를 쓴다(같은 이슈면 바꾼다). 트랜잭션 안에서 불러도 된다 */
export function saveIssueDetail(
  db: DatabaseSync,
  record: IssueDetailRecord,
  fetchedAt: number = Date.now()
): void {
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO cache_issue_details (repo_id, number, data, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (repo_id, number) DO UPDATE SET
         data = excluded.data, fetched_at = excluded.fetched_at`
    ).run(record.repoId, record.number, JSON.stringify(record), fetchedAt)
    db.prepare(
      `DELETE FROM cache_issue_details WHERE (repo_id, number) NOT IN (
         SELECT repo_id, number FROM cache_issue_details
         ORDER BY fetched_at DESC, repo_id, number LIMIT ?)`
    ).run(ISSUE_DETAIL_CACHE_LIMIT)
  })
}

function parse(text: string): IssueDetailRecord | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const record = value as IssueDetailRecord
    return typeof record.id === 'string' && typeof record.number === 'number' ? record : null
  } catch {
    return null
  }
}

/** 받은 상세. 받은 적 없거나 읽을 수 없으면 null. 코멘트 가능 여부는 여기서 계산한다 */
export function getIssueDetail(
  db: DatabaseSync,
  repoId: number,
  number: number
): IssueDetail | null {
  const row = db
    .prepare('SELECT data, fetched_at FROM cache_issue_details WHERE repo_id = ? AND number = ?')
    .get(repoId, number)
  if (row === undefined) return null
  const record = parse(str(row, 'data'))
  if (record === null) return null
  return {
    ...record,
    viewerCanComment: canCommentOnIssue(record.locked, record.viewerPermission),
    fetchedAt: num(row, 'fetched_at')
  }
}

/**
 * 저장소 ID → `owner/name`(캐시에서만). 저장소 행이 먼저, 없으면 그 저장소의 이슈 행
 * (언급·할당된 남의 저장소 이슈는 저장소 행이 없을 수 있다). 모르면 null.
 */
export function lookupRepoFullName(db: DatabaseSync, repoId: number): string | null {
  const repo = db
    .prepare("SELECT full_name FROM cache_repositories WHERE id = ? AND full_name <> ''")
    .get(repoId)
  if (repo !== undefined) return str(repo, 'full_name')
  const issue = db
    .prepare(
      "SELECT repo_full_name FROM cache_issues WHERE repo_id = ? AND repo_full_name <> '' LIMIT 1"
    )
    .get(repoId)
  return issue === undefined ? null : str(issue, 'repo_full_name')
}

/** 상세를 바꾸기 전 값(data 열 원문). restoreIssueDetail 로 정확히 되돌린다 */
export interface IssueDetailSnapshot {
  repoId: number
  number: number
  data: string
}

/**
 * 캐시된 상세를 바꾼다(쓰기 동작의 낙관적 갱신·성공 반영). data 열만 바꾸고 받은 시각·개수 제한은 건드리지 않는다.
 * 상세가 없거나 읽을 수 없으면 null. mutate 가 null 을 돌려주면 바꾸지 않고 null.
 * 바꾸기 전 원문을 돌려준다.
 */
export function patchIssueDetail(
  db: DatabaseSync,
  repoId: number,
  number: number,
  mutate: (record: IssueDetailRecord) => IssueDetailRecord | null
): IssueDetailSnapshot | null {
  return withTransaction(db, () => {
    const row = db
      .prepare('SELECT data FROM cache_issue_details WHERE repo_id = ? AND number = ?')
      .get(repoId, number)
    if (row === undefined) return null
    const data = str(row, 'data')
    const record = parse(data)
    if (record === null) return null
    const next = mutate(record)
    if (next === null) return null
    // 읽을 때 붙이는 값은 저장하지 않는다
    const {
      viewerCanComment: _c,
      fetchedAt: _f,
      ...stored
    } = next as IssueDetailRecord & Partial<Pick<IssueDetail, 'viewerCanComment' | 'fetchedAt'>>
    db.prepare('UPDATE cache_issue_details SET data = ? WHERE repo_id = ? AND number = ?').run(
      JSON.stringify(stored),
      repoId,
      number
    )
    return { repoId, number, data }
  })
}

/**
 * patchIssueDetail 전 값으로 되돌린다. 그사이 행이 지워졌으면(로그아웃·계정 전환·개수 제한) 다시 만들지 않는다.
 * isCurrent 는 patch 전에 잡은 계정 데이터 세대(currentDataGuard())다. 세대가 바뀌었으면(그사이 로그아웃·계정 전환 뒤
 * 다시 받은 상세가 있을 수 있다) 아무것도 쓰지 않는다. 되돌렸으면 true.
 */
export function restoreIssueDetail(
  db: DatabaseSync,
  snapshot: IssueDetailSnapshot,
  isCurrent: () => boolean
): boolean {
  if (!isCurrent()) return false
  db.prepare('UPDATE cache_issue_details SET data = ? WHERE repo_id = ? AND number = ?').run(
    snapshot.data,
    snapshot.repoId,
    snapshot.number
  )
  return true
}
