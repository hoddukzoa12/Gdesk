import type { IssueRow } from '@shared/domain/issue'
import type { IssueRef } from '@shared/domain/issue-detail'
import { ISSUES_TABS, type IssuesTab } from '@shared/domain/queries'

/**
 * 이슈 화면의 순수 로직(spec §6.1): 주소 상태, 필터 선택지, 필터·정렬, 실패 이유 번역 키.
 */

/** 정렬: 최신순(생성일, 기본) · 최근 갱신순 · 댓글 많은 순 */
export type IssueSort = 'newest' | 'updated' | 'comments'
export const ISSUE_SORTS: readonly IssueSort[] = ['newest', 'updated', 'comments']

/** 주소(`?tab=…&repo=…&label=…&assignee=…&sort=…&issue=<저장소 ID>-<번호>`)에 두는 화면 상태 */
export interface IssuesUrlState {
  tab: IssuesTab
  /** 저장소 ID. null 이면 전체 */
  repo: number | null
  /** 라벨 이름. null 이면 전체 */
  label: string | null
  /** 담당자 로그인. null 이면 전체 */
  assignee: string | null
  sort: IssueSort
  /** 상세 패널에 연 이슈 */
  issue: IssueRef | null
}

export const DEFAULT_URL_STATE: IssuesUrlState = {
  tab: 'incoming',
  repo: null,
  label: null,
  assignee: null,
  sort: 'newest',
  issue: null
}

function positiveInt(value: string | undefined | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

/** `101-45` → { repoId: 101, number: 45 }. 모양이 다르면 null */
export function parseIssueKey(value: string | null): IssueRef | null {
  if (!value) return null
  const m = /^(\d+)-(\d+)$/.exec(value)
  if (!m) return null
  const repoId = positiveInt(m[1])
  const number = positiveInt(m[2])
  return repoId !== null && number !== null ? { repoId, number } : null
}

export function issueKey(ref: IssueRef): string {
  return `${ref.repoId}-${ref.number}`
}

export function sameIssue(a: IssueRef | null, b: IssueRef | null): boolean {
  if (!a || !b) return a === b
  return a.repoId === b.repoId && a.number === b.number
}

function nonEmpty(value: string | null): string | null {
  return value && value.length > 0 ? value : null
}

/** 주소 검색 값 → 화면 상태. 모르는 값은 기본으로 */
export function parseUrlState(params: URLSearchParams): IssuesUrlState {
  const tab = ISSUES_TABS.find((t) => t === params.get('tab')) ?? DEFAULT_URL_STATE.tab
  const sort = ISSUE_SORTS.find((s) => s === params.get('sort')) ?? DEFAULT_URL_STATE.sort
  return {
    tab,
    repo: positiveInt(params.get('repo')),
    label: nonEmpty(params.get('label')),
    assignee: nonEmpty(params.get('assignee')),
    sort,
    issue: parseIssueKey(params.get('issue'))
  }
}

/** 화면 상태 → 주소 검색 값. 기본값은 빼서 주소를 짧게 둔다 */
export function serializeUrlState(state: IssuesUrlState): URLSearchParams {
  const out = new URLSearchParams()
  if (state.tab !== DEFAULT_URL_STATE.tab) out.set('tab', state.tab)
  if (state.repo !== null) out.set('repo', String(state.repo))
  if (state.label !== null) out.set('label', state.label)
  if (state.assignee !== null) out.set('assignee', state.assignee)
  if (state.sort !== DEFAULT_URL_STATE.sort) out.set('sort', state.sort)
  if (state.issue !== null) out.set('issue', issueKey(state.issue))
  return out
}

/**
 * 상태 바꾸기. 탭을 바꾸면 저장소·라벨·담당자 필터를 푼다(선택지가 탭 목록에서 나오므로).
 * 정렬과 연 이슈는 그대로 둔다.
 */
export function updateUrlState(
  state: IssuesUrlState,
  patch: Partial<IssuesUrlState>
): IssuesUrlState {
  const next = { ...state, ...patch }
  if (patch.tab !== undefined && patch.tab !== state.tab) {
    next.repo = patch.repo ?? null
    next.label = patch.label ?? null
    next.assignee = patch.assignee ?? null
  }
  return next
}

export interface FilterOption {
  value: string
  label: string
  /** 라벨 색(라벨 필터만) */
  color?: string | null
}

export interface IssueFilterOptions {
  repos: FilterOption[]
  labels: FilterOption[]
  assignees: FilterOption[]
}

const byLabel = (a: FilterOption, b: FilterOption): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

/** 현재 탭 목록에 있는 저장소·라벨·담당자(이름 순, 중복 없음) */
export function filterOptions(rows: readonly IssueRow[]): IssueFilterOptions {
  const repos = new Map<string, FilterOption>()
  const labels = new Map<string, FilterOption>()
  const assignees = new Map<string, FilterOption>()
  for (const row of rows) {
    const repoValue = String(row.repoId)
    if (!repos.has(repoValue)) repos.set(repoValue, { value: repoValue, label: row.repoFullName })
    for (const label of row.labels) {
      if (!labels.has(label.name)) {
        labels.set(label.name, { value: label.name, label: label.name, color: label.color })
      }
    }
    for (const actor of row.assignees) {
      if (!assignees.has(actor.login)) {
        assignees.set(actor.login, { value: actor.login, label: actor.login })
      }
    }
  }
  return {
    repos: [...repos.values()].sort(byLabel),
    labels: [...labels.values()].sort(byLabel),
    assignees: [...assignees.values()].sort(byLabel)
  }
}

function time(value: string): number {
  const t = Date.parse(value)
  return Number.isNaN(t) ? 0 : t
}

/** 필터(저장소·라벨·담당자 모두 만족) 후 정렬. 원래 배열은 바꾸지 않는다 */
export function applyFilters(
  rows: readonly IssueRow[],
  state: Pick<IssuesUrlState, 'repo' | 'label' | 'assignee' | 'sort'>
): IssueRow[] {
  const filtered = rows.filter(
    (row) =>
      (state.repo === null || row.repoId === state.repo) &&
      (state.label === null || row.labels.some((l) => l.name === state.label)) &&
      (state.assignee === null || row.assignees.some((a) => a.login === state.assignee))
  )
  const tieBreak = (a: IssueRow, b: IssueRow): number =>
    time(b.updatedAt) - time(a.updatedAt) || b.number - a.number
  const compare: Record<IssueSort, (a: IssueRow, b: IssueRow) => number> = {
    newest: (a, b) => time(b.createdAt) - time(a.createdAt) || tieBreak(a, b),
    updated: (a, b) => time(b.updatedAt) - time(a.updatedAt) || b.number - a.number,
    comments: (a, b) => b.commentCount - a.commentCount || tieBreak(a, b)
  }
  return filtered.sort(compare[state.sort])
}

/** 쓰기 실패·막힘 이유 → `issues` 네임스페이스 번역 키. 모르는 값은 일반 실패 문구 */
const FAILURE_REASONS = [
  'offline',
  'session_expired',
  'rate_limited',
  'signed_out',
  'not_allowed',
  'not_cached',
  'empty_body',
  'empty_title',
  'repo_not_mine',
  'repo_fork',
  'repo_archived',
  'repo_issues_disabled',
  'failed'
] as const

export function failureKey(reason: string): string {
  return (FAILURE_REASONS as readonly string[]).includes(reason)
    ? `failure.${reason}`
    : 'failure.failed'
}

/** 실패 결과 → 화면 문구 재료(번역 키 + GitHub 문구). failed 면 message 를 덧붙인다 */
export function failureMessage(
  result: { reason: string; message?: string },
  t: (key: string) => string
): string {
  const base = t(failureKey(result.reason))
  return result.reason === 'failed' && result.message ? `${base} ${result.message}` : base
}

/** 쓰기 버튼을 막는 이유 → 번역 키 */
export function blockedKey(reason: string): string {
  return ['offline', 'session_expired', 'rate_limited', 'signed_out'].includes(reason)
    ? `blocked.${reason}`
    : 'blocked.offline'
}
