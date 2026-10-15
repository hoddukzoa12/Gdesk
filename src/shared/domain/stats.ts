/** 하루 단위 개수. date 는 `YYYY-MM-DD`(기준 시간대의 달력 날짜) */
export interface DailyCount {
  date: string
  count: number
}

/** 스타 증가 (spec §4.2, §4.9) */
export interface StarGrowth {
  repoId: number
  /** 일별 증가. 오래된 날 → 오늘 순. 마지막 항목이 오늘(진행 중) */
  daily: DailyCount[]
  /** daily 의 합 */
  total: number
  /** 아주 큰 저장소라 스타 시각을 다 받지 못했으면 true (값이 실제보다 적을 수 있음) */
  truncated: boolean
}

/** 기본 창 크기(일). 둘 다 조정 가능 */
export const STAR_DETAIL_WINDOW_DAYS = 30
export const STAR_HOME_WINDOW_DAYS = 7
