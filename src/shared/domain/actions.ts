/**
 * 쓰기 동작(스타·스타 취소, 알림 읽음·완료, spec §6).
 * 연결 상태가 online 이 아니거나 로그인되어 있지 않으면 요청하지 않고 거절한다.
 */

/** 쓰기 동작을 막는 이유. 우선순위 session_expired > signed_out > offline > rate_limited */
export type ActionBlockReason = 'offline' | 'session_expired' | 'rate_limited' | 'signed_out'

export const ACTION_BLOCK_REASONS: readonly ActionBlockReason[] = [
  'offline',
  'session_expired',
  'rate_limited',
  'signed_out'
]

/** 버튼을 켤지 정하는 값 */
export type ActionAvailability =
  { available: true } | { available: false; reason: ActionBlockReason }

/**
 * 쓰기 동작의 결과.
 * - 막힘(reason 이 ActionBlockReason): 요청도 캐시 변경도 하지 않았다.
 * - failed: 캐시를 먼저 바꿨다가 GitHub 요청이 실패해 원래대로 되돌렸다. message 는 화면에 보여도 되는
 *   문구(토큰 없음)다. 캐시에 없는 저장소를 스타하려 할 때도 failed(요청 없음).
 */
export type ActionResult =
  | { ok: true }
  | { ok: false; reason: ActionBlockReason }
  | { ok: false; reason: 'failed'; message: string }
