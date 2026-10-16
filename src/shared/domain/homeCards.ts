import type { HomeCardSetting } from './settings'

/** Home 카드 다섯 종류 (spec §4.2). 기본 순서이며 기본으로 모두 켜져 있다 */
export const HOME_CARD_IDS = [
  'reviewRequests',
  'unreadNotifications',
  'failedCi',
  'unanswered',
  'starChanges'
] as const

export type HomeCardId = (typeof HOME_CARD_IDS)[number]

export interface ResolvedHomeCard {
  id: HomeCardId
  enabled: boolean
}

export function isHomeCardId(id: string): id is HomeCardId {
  return (HOME_CARD_IDS as readonly string[]).includes(id)
}

/**
 * 저장된 홈 카드 설정을 화면에 쓸 목록으로 푼다.
 * - 빈 목록이면 기본 순서로 모두 켠다.
 * - 모르는 ID 와 중복 ID(두 번째부터)는 버린다.
 * - 저장된 목록에 없는 카드는 켠 채로 기본 순서대로 끝에 붙인다.
 */
export function resolveHomeCards(stored: readonly HomeCardSetting[]): ResolvedHomeCard[] {
  const result: ResolvedHomeCard[] = []
  const seen = new Set<HomeCardId>()
  for (const { id, enabled } of stored) {
    if (!isHomeCardId(id) || seen.has(id)) continue
    seen.add(id)
    result.push({ id, enabled })
  }
  for (const id of HOME_CARD_IDS) {
    if (!seen.has(id)) result.push({ id, enabled: true })
  }
  return result
}

/** 인사말 아래 새 영역 다섯 개. 기본 순서이며 기존 카드보다 앞에 온다 */
export const NEW_HOME_SECTION_IDS = [
  'stats',
  'pinnedRepos',
  'contributions',
  'recentCommits',
  'myPullRequests'
] as const

/**
 * Home 영역 열 개(인사말은 늘 맨 위라 들어가지 않는다). 기본 순서이며 기본으로 모두 켜져 있다.
 * 기존 카드 다섯 개(`HOME_CARD_IDS`)를 포함한다. 화면이 이 목록으로 옮겨 가면 둘을 합친다.
 */
export const HOME_SECTION_IDS = [...NEW_HOME_SECTION_IDS, ...HOME_CARD_IDS] as const

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number]

export interface ResolvedHomeSection {
  id: HomeSectionId
  enabled: boolean
}

export function isHomeSectionId(id: string): id is HomeSectionId {
  return (HOME_SECTION_IDS as readonly string[]).includes(id)
}

/**
 * 저장된 홈 카드 설정을 열 개 영역 목록으로 푼다.
 * - 빈 목록이면 기본 순서로 모두 켠다.
 * - 모르는 ID 와 중복 ID(두 번째부터)는 버린다.
 * - 저장된 목록에 새 영역 ID 가 하나도 없으면(새 영역 전의 설정) 새 영역 다섯 개를 켠 채로 기본 순서대로
 *   맨 앞에 넣는다. 기존 카드의 켬·끔과 순서는 그대로다. 결과에 새 ID 가 들어가므로 한 번만 일어난다.
 * - 그 밖에 저장된 목록에 없는 영역은 켠 채로 기본 순서대로 끝에 붙인다.
 */
export function resolveHomeSections(stored: readonly HomeCardSetting[]): ResolvedHomeSection[] {
  const known: ResolvedHomeSection[] = []
  const seen = new Set<HomeSectionId>()
  for (const { id, enabled } of stored) {
    if (!isHomeSectionId(id) || seen.has(id)) continue
    seen.add(id)
    known.push({ id, enabled })
  }
  const hasNew = NEW_HOME_SECTION_IDS.some((id) => seen.has(id))
  const result: ResolvedHomeSection[] = hasNew
    ? known
    : [...NEW_HOME_SECTION_IDS.map((id) => ({ id, enabled: true })), ...known]
  for (const { id } of result) seen.add(id)
  for (const id of HOME_SECTION_IDS) {
    if (!seen.has(id)) result.push({ id, enabled: true })
  }
  return result
}
