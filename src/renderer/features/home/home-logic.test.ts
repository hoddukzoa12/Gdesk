import { describe, expect, it } from 'vitest'
import {
  CONTRIBUTION_LEVELS,
  PR_DISPLAY_STATUSES,
  type ContributionDay,
  type ContributionLevel
} from '@shared/domain/home-activity'
import {
  HEAT_CLASS,
  HEATMAP_WEEKS,
  MISSING_VALUE,
  PR_PILL_CLASS,
  QUOTE_COUNT,
  buildHeatmap,
  firstLine,
  formatStat,
  greetingName,
  quoteIndexForDate,
  shortSha,
  weekdayRow
} from './home-logic'

describe('오늘의 한마디', () => {
  it('같은 현지 날짜는 시각과 무관하게 같은 한마디', () => {
    const morning = new Date(2026, 9, 16, 0, 0, 1)
    const night = new Date(2026, 9, 16, 23, 59, 59)
    expect(quoteIndexForDate(morning)).toBe(quoteIndexForDate(night))
  })

  it('다음 날은 다음 한마디이고, 여덟 날마다 돈다', () => {
    const day = new Date(2026, 9, 16, 12)
    const next = new Date(2026, 9, 17, 9)
    const i = quoteIndexForDate(day)
    expect(quoteIndexForDate(next)).toBe((i + 1) % QUOTE_COUNT)
    expect(quoteIndexForDate(next)).not.toBe(i)
    expect(quoteIndexForDate(new Date(2026, 9, 16 + QUOTE_COUNT, 8))).toBe(i)
  })

  it('달·해 경계도 하루씩 넘어간다', () => {
    const dec31 = quoteIndexForDate(new Date(2025, 11, 31, 22))
    const jan1 = quoteIndexForDate(new Date(2026, 0, 1, 1))
    expect(jan1).toBe((dec31 + 1) % QUOTE_COUNT)
  })

  it('늘 0 … 7 안의 값', () => {
    for (let d = 0; d < 40; d++) {
      const i = quoteIndexForDate(new Date(1969, 11, 1 + d))
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(QUOTE_COUNT)
    }
  })
})

describe('인사말 이름', () => {
  it('이름이 있으면 이름, 없거나 비었으면 로그인', () => {
    expect(greetingName({ login: 'octo', name: 'Octo Cat' })).toBe('Octo Cat')
    expect(greetingName({ login: 'octo', name: null })).toBe('octo')
    expect(greetingName({ login: 'octo', name: '  ' })).toBe('octo')
    expect(greetingName(undefined)).toBe('')
  })
})

describe('수치', () => {
  const nf = new Intl.NumberFormat('en')
  it('null 은 —, 값은 숫자 형식', () => {
    expect(formatStat(null, nf)).toBe(MISSING_VALUE)
    expect(MISSING_VALUE).toBe('—')
    expect(formatStat(0, nf)).toBe('0')
    expect(formatStat(1248, nf)).toBe('1,248')
  })
})

/** `start`(YYYY-MM-DD, UTC)부터 `n` 일 */
function daysFrom(start: string, n: number, level: ContributionLevel = 'NONE'): ContributionDay[] {
  const base = Date.parse(`${start}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base + i * 86_400_000)
    return {
      date: d.toISOString().slice(0, 10),
      count: i,
      level,
      weekday: d.getUTCDay()
    }
  })
}

describe('기여 달력 배치', () => {
  it('요일 → 월–일 행', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(weekdayRow)).toEqual([6, 0, 1, 2, 3, 4, 5])
  })

  it('GitHub 의 53주(일요일 시작, 오늘에서 끝)를 월요일 시작 53열에 놓고 오늘이 마지막 열', () => {
    // 2025-10-12(일) … 2026-10-16(금): 52주 + 6일 = 370일
    const days = daysFrom('2025-10-12', 370)
    expect(days[0]?.weekday).toBe(0)
    expect(days.at(-1)?.date).toBe('2026-10-16')
    const map = buildHeatmap(days)
    expect(map.weeks).toBe(HEATMAP_WEEKS)
    const cols = new Set(map.cells.map((c) => c.col))
    expect(Math.min(...cols)).toBe(0)
    expect(Math.max(...cols)).toBe(52)
    const today = map.cells.find((c) => c.date === '2026-10-16')
    expect(today).toMatchObject({ col: 52, row: 4 }) // 금요일
    const monday = map.cells.find((c) => c.date === '2026-10-12')
    expect(monday).toMatchObject({ col: 52, row: 0 })
    const sunday = map.cells.find((c) => c.date === '2026-10-11')
    expect(sunday).toMatchObject({ col: 51, row: 6 })
    // 54번째(가장 오래된) 열의 일요일 하나는 잘린다
    expect(map.cells.some((c) => c.date === '2025-10-12')).toBe(false)
    expect(map.cells).toHaveLength(369)
    // 칸이 겹치지 않는다
    expect(new Set(map.cells.map((c) => `${c.col}:${c.row}`)).size).toBe(map.cells.length)
  })

  it('모든 칸의 행은 요일에서 온다', () => {
    const map = buildHeatmap(daysFrom('2025-10-12', 370))
    for (const cell of map.cells) expect(cell.row).toBe((cell.weekday + 6) % 7)
  })

  it('날이 적으면 오른쪽(이번 주)에 맞춘다', () => {
    const map = buildHeatmap(daysFrom('2026-10-12', 5)) // 월 … 금
    expect(map.cells.map((c) => [c.col, c.row])).toEqual([
      [52, 0],
      [52, 1],
      [52, 2],
      [52, 3],
      [52, 4]
    ])
  })

  it('빈 목록은 빈 칸', () => {
    expect(buildHeatmap([])).toEqual({ weeks: HEATMAP_WEEKS, cells: [], months: [] })
  })

  it('달 이름은 달이 바뀌는 열에 붙는다', () => {
    const map = buildHeatmap(daysFrom('2025-10-12', 370))
    const labels = map.months.map((m) => m.date.slice(0, 7))
    expect(labels).toContain('2026-01')
    expect(labels.at(-1)).toBe('2026-10')
    // 같은 달이 두 번 나오지 않는다
    expect(new Set(labels).size).toBe(labels.length)
    // 열 순서
    const cols = map.months.map((m) => m.col)
    expect([...cols].sort((a, b) => a - b)).toEqual(cols)
  })

  it('수준 → 잔디 색 토큰 0~4', () => {
    expect(CONTRIBUTION_LEVELS.map((l) => HEAT_CLASS[l])).toEqual([
      'bg-heat-0',
      'bg-heat-1',
      'bg-heat-2',
      'bg-heat-3',
      'bg-heat-4'
    ])
  })
})

describe('내 PR 상태 알약', () => {
  it('상태마다 색: 초안 회색, 변경 요청 빨강, 승인 초록, 리뷰 필요 보라, 열림 초록 테두리', () => {
    expect(Object.keys(PR_PILL_CLASS).sort()).toEqual([...PR_DISPLAY_STATUSES].sort())
    expect(PR_PILL_CLASS.draft).toContain('text-fg-muted')
    expect(PR_PILL_CLASS.changes_requested).toContain('text-danger')
    expect(PR_PILL_CLASS.approved).toContain('bg-success/15')
    expect(PR_PILL_CLASS.review_required).toContain('text-merged')
    expect(PR_PILL_CLASS.open).toContain('border-success')
    expect(PR_PILL_CLASS.open).toContain('bg-transparent')
  })
})

describe('최근 커밋', () => {
  it('짧은 SHA 7자, 메시지 첫 줄', () => {
    expect(shortSha('abcdef1234567890')).toBe('abcdef1')
    expect(firstLine('Fix it\n\nbody')).toBe('Fix it')
  })
})
