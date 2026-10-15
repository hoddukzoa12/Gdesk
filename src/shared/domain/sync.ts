import type { ConnectionStatus } from './connection'
import type { OrgRestrictionNotice } from './org'

/**
 * 자동 갱신(spec §6) 상태. 사이드바 아래쪽의 "N초 전 동기화" · "오프라인 · N분 전 정보" ·
 * 한도 대기 표시가 이 값을 쓴다.
 */
export interface SyncStatus {
  /** GitHub 요청 계층의 연결 상태(유일한 출처) */
  connection: ConnectionStatus
  /** 마지막으로 무언가를 받아 저장한 시각(epoch ms). 아직 없으면 null */
  lastSyncedAt: number | null
  /** 한도 막힘이 풀리는 시각(epoch ms). 막힘이 없으면 null */
  rateLimitedUntil: number | null
  /** 지금 갱신 중인가 */
  syncing: boolean
  /** 조직 접근 제한 안내 */
  orgRestrictions: OrgRestrictionNotice[]
}

/** 화면별 수동 새로고침 범위. `repo:<저장소 ID>` 는 저장소 상세 화면 */
export type RefreshScope =
  'home' | 'inbox' | 'pulls' | 'reviews' | 'issues' | 'starred' | 'repositories' | `repo:${number}`

export const REFRESH_SCREENS = [
  'home',
  'inbox',
  'pulls',
  'reviews',
  'issues',
  'starred',
  'repositories'
] as const

/** 화면 값 검사: 알 수 없는 범위면 null */
export function parseRefreshScope(value: unknown): RefreshScope | null {
  if (typeof value !== 'string') return null
  if ((REFRESH_SCREENS as readonly string[]).includes(value)) return value as RefreshScope
  const match = /^repo:([1-9]\d*)$/.exec(value)
  if (match && Number.isSafeInteger(Number(match[1]))) return value as RefreshScope
  return null
}
