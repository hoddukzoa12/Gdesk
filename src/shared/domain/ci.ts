/**
 * CI 상태 (spec §7). GitHub 통합 상태(statusCheckRollup: Check Run + 기존 Status)를 기준으로 판정한다.
 * 화면의 CiStatusIcon 과 같은 값 집합이다.
 */
export type CiStatus = 'passing' | 'failing' | 'pending' | 'none'

export const CI_STATUSES: readonly CiStatus[] = ['passing', 'failing', 'pending', 'none']

/** GitHub GraphQL `StatusState` (statusCheckRollup.state) */
export type CheckRollupState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED'
