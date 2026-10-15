/**
 * GitHub 연결 상태 (spec §7). 화면에는 이 중 하나만 보인다.
 * 상태의 유일한 출처는 메인 프로세스의 GitHub 요청 계층이다. 동기화·쓰기 서비스는 구독만 한다.
 */
export type ConnectionStatus = 'online' | 'offline' | 'rate_limited' | 'session_expired'

export const CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  'online',
  'offline',
  'rate_limited',
  'session_expired'
]

/** 동시에 참일 수 있는 조건들 */
export interface ConnectionFlags {
  sessionExpired?: boolean
  offline?: boolean
  rateLimited?: boolean
}

/** 겹치면 우선순위 session_expired > offline > rate_limited > online 으로 하나만 고른다. */
export function resolveConnectionStatus(flags: ConnectionFlags): ConnectionStatus {
  if (flags.sessionExpired) return 'session_expired'
  if (flags.offline) return 'offline'
  if (flags.rateLimited) return 'rate_limited'
  return 'online'
}
