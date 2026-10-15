import type { FeatureSlots } from '@renderer/app/slots'
import { CrashDialog } from './CrashDialog'

// 오류 보고 대화상자. 화면 오류 감시도 이 오버레이가 마운트될 때 설치한다.
export const slots: FeatureSlots = {
  overlays: [CrashDialog]
}
