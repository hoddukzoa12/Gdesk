import type { FeatureSlots } from '@renderer/app/slots'
import { UpdaterBanner } from './UpdaterBanner'

// 업데이트 알림은 다른 상태 배너(오프라인, 세션 만료)보다 아래에 둔다.
export const slots: FeatureSlots = {
  banners: [{ order: 100, Component: UpdaterBanner }]
}
