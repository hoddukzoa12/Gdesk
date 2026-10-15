/**
 * "응답 없는 새 기여" 판정 (spec §4.2).
 * 내 저장소 집합의 열린 이슈·PR 중 아래를 모두 만족하는 것:
 * 1. 작성자가 그 저장소의 쓰기 권한자가 아니다 (authorAssociation 이 OWNER·MEMBER·COLLABORATOR 가 아님)
 * 2. 쓰기 권한자의 코멘트나 리뷰가 하나도 없다
 * 3. 작성자가 봇 계정이 아니다 (조정 가능, 기본 켬)
 */
export const WRITE_HOLDER_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'] as const

export function isWriteHolderAssociation(association: string | null | undefined): boolean {
  return (
    typeof association === 'string' &&
    (WRITE_HOLDER_ASSOCIATIONS as readonly string[]).includes(association)
  )
}

export interface ResponseFacts {
  authorAssociation: string | null
}

/**
 * 받은 코멘트·리뷰 중 쓰기 권한자의 것이 있는가.
 * 수집기는 가장 최근 코멘트·리뷰 N개(기본 50, 메인테이너 답글은 대개 나중에 달린다)만 받는다.
 * 알려진 근사: totalCount 가 받은 개수보다 많고 받은 것 중 쓰기 권한자가 없으면, 확인하지 못한
 * 응답이 있을 수 있으므로 응답한 것으로 본다. 긴 토론이 있는 스레드는 "새 기여"로 보지 않는 보수적인 선택이다.
 */
export function hasWriteHolderResponse(
  responses: readonly ResponseFacts[],
  totalCount: number = responses.length
): boolean {
  if (responses.some((r) => isWriteHolderAssociation(r.authorAssociation))) return true
  return totalCount > responses.length
}

export interface ContributionFacts {
  authorAssociation: string | null
  authorIsBot: boolean
  hasWriteHolderResponse: boolean
}

export interface UnansweredOptions {
  /** 봇 작성 항목 제외(기본 true) */
  excludeBots?: boolean
}

export function isUnansweredContribution(
  facts: ContributionFacts,
  options: UnansweredOptions = {}
): boolean {
  const excludeBots = options.excludeBots ?? true
  if (isWriteHolderAssociation(facts.authorAssociation)) return false
  if (facts.hasWriteHolderResponse) return false
  if (excludeBots && facts.authorIsBot) return false
  return true
}
