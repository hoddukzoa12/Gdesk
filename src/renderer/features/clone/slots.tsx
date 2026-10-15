import type { FeatureSlots } from '@renderer/app/slots'
import { CloneDialog } from './CloneDialog'

// 클론 대화상자. requestClone() 으로 연다.
export const slots: FeatureSlots = {
  overlays: [CloneDialog]
}
