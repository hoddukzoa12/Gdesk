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
