import { ChevronDown, Code } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components'

/**
 * 저장소 머리글의 Clone/Open 메뉴 자리. 나중 작업이 이 파일만 바꿔 실제 메뉴를 넣는다.
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
}

/** 자리표시: 아직 클론 기능이 없어서 꺼진 "Clone" 버튼. */
export function RepoCloneSlot(_props: RepoCloneSlotProps) {
  const { t } = useTranslation('repo')
  return (
    <Button disabled title={t('actions.cloneUnavailable')} data-testid="repo-clone-button">
      <Code />
      {t('actions.clone')}
      <ChevronDown />
    </Button>
  )
}
