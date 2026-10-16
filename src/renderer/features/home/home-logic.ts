import type {
  ContributionDay,
  ContributionLevel,
  PrDisplayStatus
} from '@shared/domain/home-activity'
import type { HomeSectionId } from '@shared/domain/homeCards'

// Home 화면의 순수 로직. 컴포넌트와 테스트가 함께 쓴다.

// ───────────── 오늘의 한마디 ─────────────

/** 번역 파일 `quotes.0` … `quotes.7` 의 개수 */
export const QUOTE_COUNT = 8

const DAY_MS = 86_400_000

/** 현지 달력 날짜의 일련번호(1970-01-01 = 0). 시각·시간대 오프셋과 무관하게 날짜만 본다 */
export function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

/** 현지 날짜마다 한마디 하나. 같은 날은 늘 같고, 다음 날은 다음 한마디다 */
export function quoteIndexForDate(date: Date, count = QUOTE_COUNT): number {
  return ((localDayNumber(date) % count) + count) % count
}

// ───────────── 인사말 ─────────────

/** 인사말에 쓸 이름: 프로필 이름, 없으면 로그인 이름 */
export function greetingName(user: { login: string; name: string | null } | undefined): string {
  if (!user) return ''
  return user.name?.trim() || user.login
}

// ───────────── 영역 배치 ─────────────

/** 두 열 배치에서도 한 줄을 다 쓰는 영역 */
export const FULL_WIDTH_SECTIONS: ReadonlySet<HomeSectionId> = new Set<HomeSectionId>(['stats'])

// ───────────── 수치 ─────────────

/** 받지 못한 값 표시 */
export const MISSING_VALUE = '—'

export function formatStat(value: number | null, nf: Intl.NumberFormat): string {
  return value == null ? MISSING_VALUE : nf.format(value)
}

// ───────────── 기여 달력 ─────────────

/** 달력 열(주) 수: 최근 12개월 */
export const HEATMAP_WEEKS = 53

/** 기여 수준 → 테마 색(잔디 0~4). Tailwind 가 찾을 수 있게 클래스 이름을 그대로 적는다 */
export const HEAT_CLASS: Record<ContributionLevel, string> = {
  NONE: 'bg-heat-0',
  FIRST_QUARTILE: 'bg-heat-1',
  SECOND_QUARTILE: 'bg-heat-2',
  THIRD_QUARTILE: 'bg-heat-3',
  FOURTH_QUARTILE: 'bg-heat-4'
}

/** 범례 순서(적음 → 많음) */
export const HEAT_LEGEND: readonly string[] = [
  'bg-heat-0',
  'bg-heat-1',
  'bg-heat-2',
  'bg-heat-3',
  'bg-heat-4'
]

/** 요일(0 = 일요일) → 월–일 행 번호(0 = 월요일) */
export function weekdayRow(weekday: number): number {
  return (((weekday + 6) % 7) + 7) % 7
}

export interface HeatCell extends ContributionDay {
  /** 0 = 월요일 … 6 = 일요일 */
  row: number
  /** 0 = 가장 오래된 주 … weeks-1 = 이번 주 */
  col: number
}

export interface MonthLabel {
  col: number
  /** 그 열에서 시작하는 달의 아무 날(`YYYY-MM-DD`). 화면이 달 이름으로 바꾼다 */
  date: string
}

export interface Heatmap {
  weeks: number
  cells: HeatCell[]
  months: MonthLabel[]
}

/**
 * 기여 달력 칸 배치. 날은 오래된 날 → 오늘 순으로 이어져 있다고 본다.
 * 행은 요일(월–일), 열은 월요일에 시작하는 주다. 마지막 열이 이번 주가 되도록 오른쪽에 맞추고,
 * `weeks` 보다 오래된 주는 버린다. 달 이름은 열의 첫 날이 앞 열과 다른 달일 때 붙인다.
 */
export function buildHeatmap(days: readonly ContributionDay[], weeks = HEATMAP_WEEKS): Heatmap {
  const first = days[0]
  if (!first) return { weeks, cells: [], months: [] }
  const offset = weekdayRow(first.weekday)
  const placed = days.map((day, i) => ({
    ...day,
    row: weekdayRow(day.weekday),
    col: Math.floor((i + offset) / 7)
  }))
  const lastCol = placed[placed.length - 1]?.col ?? 0
  const shift = lastCol + 1 - weeks
  const cells = placed
    .map((cell) => ({ ...cell, col: cell.col - shift }))
    .filter((cell) => cell.col >= 0 && cell.col < weeks)

  const firstOfCol = new Map<number, HeatCell>()
  for (const cell of cells) {
    const prev = firstOfCol.get(cell.col)
    if (!prev || cell.row < prev.row) firstOfCol.set(cell.col, cell)
  }
  const months: MonthLabel[] = []
  let prevMonth: string | null = null
  for (let col = 0; col < weeks; col++) {
    const cell = firstOfCol.get(col)
    if (!cell) continue
    const month = cell.date.slice(0, 7)
    if (month !== prevMonth) months.push({ col, date: cell.date })
    prevMonth = month
  }
  // 첫 달 이름이 다음 달 이름과 겹칠 만큼 가까우면 뺀다
  const [a, b] = months
  if (a && b && b.col - a.col < 3) months.shift()
  return { weeks, cells, months }
}

// ───────────── 내 PR ─────────────

/** PR 표시 상태 → 알약 색. 초안 회색, 변경 요청 빨강, 승인 초록, 리뷰 필요 보라(병합 색), 열림 초록 테두리 */
export const PR_PILL_CLASS: Record<PrDisplayStatus, string> = {
  draft: 'border-transparent bg-neutral/20 text-fg-muted',
  changes_requested: 'border-transparent bg-danger/15 text-danger',
  approved: 'border-transparent bg-success/15 text-success',
  review_required: 'border-transparent bg-merged/15 text-merged',
  open: 'border-success bg-transparent text-success'
}

// ───────────── 최근 커밋 ─────────────

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function firstLine(message: string): string {
  return message.split('\n')[0] ?? ''
}
