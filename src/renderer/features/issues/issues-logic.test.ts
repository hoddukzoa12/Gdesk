import { describe, expect, it } from 'vitest'
import type { IssueRow } from '@shared/domain/issue'
import {
  DEFAULT_URL_STATE,
  applyFilters,
  failureKey,
  failureMessage,
  filterOptions,
  parseIssueKey,
  parseUrlState,
  serializeUrlState,
  updateUrlState,
  type IssuesUrlState
} from './issues-logic'

function row(repoId: number, number: number, extra: Partial<IssueRow> = {}): IssueRow {
  return {
    id: `I_${repoId}_${number}`,
    repoId,
    repoFullName: `o/r${repoId}`,
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r${repoId}/issues/${number}`,
    author: { login: 'bob', avatarUrl: null, isBot: false },
    labels: [],
    assignees: [],
    commentCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra
  }
}

const actor = (login: string) => ({ login, avatarUrl: null, isBot: false })

const rows: IssueRow[] = [
  row(1, 10, {
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
    commentCount: 2,
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [actor('alice')]
  }),
  row(2, 20, {
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-06T00:00:00Z',
    commentCount: 9,
    labels: [
      { name: 'docs', color: '0075ca' },
      { name: 'bug', color: 'd73a4a' }
    ],
    assignees: [actor('dave'), actor('alice')]
  }),
  row(1, 11, {
    createdAt: '2026-10-03T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
    commentCount: 0
  })
]

const numbers = (list: IssueRow[]) => list.map((r) => r.number)
const base = { repo: null, label: null, assignee: null } as const

describe('applyFilters: 정렬', () => {
  it('newest(기본): 생성일 최신순', () => {
    expect(numbers(applyFilters(rows, { ...base, sort: 'newest' }))).toEqual([20, 11, 10])
  })
  it('updated: 갱신일 최신순', () => {
    expect(numbers(applyFilters(rows, { ...base, sort: 'updated' }))).toEqual([10, 11, 20])
  })
  it('comments: 댓글 많은 순', () => {
    expect(numbers(applyFilters(rows, { ...base, sort: 'comments' }))).toEqual([20, 10, 11])
  })
  it('원래 배열은 바꾸지 않는다', () => {
    const copy = [...rows]
    applyFilters(rows, { ...base, sort: 'comments' })
    expect(rows).toEqual(copy)
  })
})

describe('applyFilters: 필터', () => {
  it.each<[string, Partial<IssuesUrlState>, number[]]>([
    ['저장소', { repo: 1 }, [11, 10]],
    ['라벨', { label: 'bug' }, [20, 10]],
    ['라벨(하나만)', { label: 'docs' }, [20]],
    ['담당자', { assignee: 'alice' }, [20, 10]],
    ['담당자(하나만)', { assignee: 'dave' }, [20]],
    ['조합', { repo: 1, label: 'bug', assignee: 'alice' }, [10]],
    ['맞는 것 없음', { repo: 2, label: 'nope' }, []]
  ])('%s', (_name, patch, expected) => {
    expect(numbers(applyFilters(rows, { ...base, sort: 'newest', ...patch }))).toEqual(expected)
  })
})

describe('filterOptions', () => {
  it('현재 목록의 저장소·라벨·담당자를 중복 없이 이름 순으로', () => {
    const opts = filterOptions(rows)
    expect(opts.repos).toEqual([
      { value: '1', label: 'o/r1' },
      { value: '2', label: 'o/r2' }
    ])
    expect(opts.labels.map((l) => l.value)).toEqual(['bug', 'docs'])
    expect(opts.labels[0]?.color).toBe('d73a4a')
    expect(opts.assignees.map((a) => a.value)).toEqual(['alice', 'dave'])
  })
  it('빈 목록', () => {
    expect(filterOptions([])).toEqual({ repos: [], labels: [], assignees: [] })
  })
})

describe('주소 상태', () => {
  it('기본값은 주소에서 뺀다', () => {
    expect(serializeUrlState(DEFAULT_URL_STATE).toString()).toBe('')
    expect(parseUrlState(new URLSearchParams())).toEqual(DEFAULT_URL_STATE)
  })

  it('왕복: 탭·필터·정렬·이슈', () => {
    const state: IssuesUrlState = {
      tab: 'mentioned',
      repo: 101,
      label: 'good first issue',
      assignee: 'alice-dev',
      sort: 'comments',
      issue: { repoId: 101, number: 45 }
    }
    const params = serializeUrlState(state)
    expect(params.get('issue')).toBe('101-45')
    expect(params.get('tab')).toBe('mentioned')
    expect(parseUrlState(new URLSearchParams(params.toString()))).toEqual(state)
  })

  it('모르는 값은 기본으로', () => {
    const state = parseUrlState(
      new URLSearchParams('tab=nope&sort=random&repo=-1&issue=abc&label=&assignee=')
    )
    expect(state).toEqual(DEFAULT_URL_STATE)
  })

  it.each([
    ['101-45', { repoId: 101, number: 45 }],
    ['0-45', null],
    ['101-0', null],
    ['101', null],
    ['101-45-1', null],
    ['99999999999999999999-1', null]
  ])('parseIssueKey(%s)', (value, expected) => {
    expect(parseIssueKey(value)).toEqual(expected)
  })

  it('탭을 바꾸면 필터를 풀고 정렬·연 이슈는 둔다', () => {
    const state: IssuesUrlState = {
      tab: 'incoming',
      repo: 1,
      label: 'bug',
      assignee: 'alice',
      sort: 'updated',
      issue: { repoId: 1, number: 10 }
    }
    expect(updateUrlState(state, { tab: 'mine' })).toEqual({
      tab: 'mine',
      repo: null,
      label: null,
      assignee: null,
      sort: 'updated',
      issue: { repoId: 1, number: 10 }
    })
    // 같은 탭이면 필터 유지
    expect(updateUrlState(state, { tab: 'incoming', sort: 'newest' }).label).toBe('bug')
  })
})

describe('실패 문구', () => {
  it.each([
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
  ])('%s', (reason) => {
    expect(failureKey(reason)).toBe(`failure.${reason}`)
  })
  it('모르는 이유는 일반 실패', () => {
    expect(failureKey('weird')).toBe('failure.failed')
  })
  it('failed 는 GitHub 문구를 덧붙인다', () => {
    const t = (k: string) => `[${k}]`
    expect(failureMessage({ reason: 'failed', message: 'boom' }, t)).toBe('[failure.failed] boom')
    expect(failureMessage({ reason: 'offline' }, t)).toBe('[failure.offline]')
  })
})
