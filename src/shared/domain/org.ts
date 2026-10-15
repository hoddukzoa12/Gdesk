/** 조직이 이 앱의 접근을 막은 이유 (spec §5) */
export type OrgRestrictionKind = 'oauth_app_restriction' | 'saml_enforcement'

/** 로그인 화면·사이드바 안내용 조직 접근 제한 정보 */
export interface OrgRestrictionNotice {
  /** 알 수 없으면 null */
  orgLogin: string | null
  reason: OrgRestrictionKind
  message: string
  /** 기록 시각(epoch ms) */
  recordedAt: number
}
