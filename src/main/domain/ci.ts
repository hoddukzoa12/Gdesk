import type { CiStatus } from '@shared/domain/ci'

/**
 * GitHub 통합 상태(statusCheckRollup.state) → CI 상태 (spec §7).
 * - SUCCESS → passing, FAILURE·ERROR → failing, PENDING·EXPECTED → pending, 값 없음 → none
 * - neutral·skipped 같은 세부 결론은 GitHub 가 통합 상태를 계산할 때 이미 SUCCESS 로 합친다
 *   (GitHub 웹 표시와 같음). 따라서 여기서는 통합 상태 값만 본다.
 * - 알 수 없는 값은 none.
 */
export function ciStatusFromRollup(state: string | null | undefined): CiStatus {
  switch (state?.toUpperCase()) {
    case 'SUCCESS':
      return 'passing'
    case 'FAILURE':
    case 'ERROR':
      return 'failing'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

/** 커밋 목록(최신 → 과거)의 요약 = 최신 커밋의 상태. 비어 있으면 none */
export function summarizeCi(statuses: readonly CiStatus[]): CiStatus {
  return statuses[0] ?? 'none'
}
