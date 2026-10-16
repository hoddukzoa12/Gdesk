import type { FeatureSlots } from '@renderer/app/slots'
import { AccountMenu } from './AccountMenu'
import { LoginGate } from './LoginGate'
import { OrgRestrictionBanner, SessionExpiredBanner, TokenWarningBanner } from './SessionBanners'
import { StoragePromptDialog } from './StoragePromptDialog'

// 세션 만료는 가장 위, 권한·조직 안내는 그 아래(업데이트 알림은 100).
export const slots: FeatureSlots = {
  sidebarBottom: AccountMenu,
  banners: [
    { order: 10, Component: SessionExpiredBanner },
    { order: 40, Component: TokenWarningBanner },
    { order: 45, Component: OrgRestrictionBanner }
  ],
  overlays: [LoginGate, StoragePromptDialog]
}
