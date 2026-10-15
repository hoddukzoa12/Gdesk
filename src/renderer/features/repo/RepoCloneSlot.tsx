import { CloneOpenMenu } from '@renderer/features/clone'

/**
 * 저장소 머리글의 Clone/Open 메뉴 자리. 실제 메뉴는 클론 기능(features/clone)이 그린다.
 * 받는 값(계약): 아래 RepoCloneSlotProps. 이름·모양을 바꾸지 말고 필요한 값만 더한다.
 */
export interface RepoCloneSlotProps {
  /** GitHub 숫자 저장소 ID */
  repoId: number
  owner: string
  name: string
  /** `owner/name` */
  fullName: string
  /** GitHub 웹 주소(예: https://github.com/owner/name). 클론 주소는 여기에 `.git` 을 붙인다 */
  url: string
  defaultBranch: string | null
  private: boolean
  className?: string
}

/** Clone/Open 메뉴: 로컬 연결이 없으면 "Clone", 있으면 "Open"(spec §4.9). */
export function RepoCloneSlot({ repoId, owner, name, className }: RepoCloneSlotProps) {
  return <CloneOpenMenu repoId={repoId} owner={owner} name={name} className={className} />
}
