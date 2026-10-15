import type { FeatureSlots, NavCounts } from '@renderer/app/slots'
import { OfflineBanner } from './OfflineBanner'
import { PinnedSection } from './PinnedSection'
import { SyncFooter } from './SyncFooter'
import { useSidebarData } from './useSidebarData'
import { YourRepositoriesSection } from './YourRepositoriesSection'

/** 메뉴 수치: Inbox = 안 읽은 알림, Pull requests = 들어온 열린 PR, Review requests = 리뷰 요청. */
function useSidebarNavCounts(): NavCounts {
  const { data } = useSidebarData()
  if (!data) return {}
  return {
    inbox: data.counts.unreadNotifications,
    pulls: data.counts.incomingPullRequests,
    reviews: data.counts.reviewRequests
  }
}

// 오프라인 배너는 세션 만료 배너(인증 작업)보다 아래, 업데이트 알림(100)보다 위에 둔다.
export const slots: FeatureSlots = {
  useNavCounts: useSidebarNavCounts,
  sidebarSections: [
    { order: 10, Component: PinnedSection },
    { order: 20, Component: YourRepositoriesSection }
  ],
  sidebarFooter: SyncFooter,
  banners: [{ order: 20, Component: OfflineBanner }]
}
