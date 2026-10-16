import type { FeatureSlots } from '@renderer/app/slots'
import { CommandPalette } from './CommandPalette'
import { PaletteButton } from './PaletteButton'

// 빠른 검색창(⌘K / Ctrl+K)과 상단 막대 맨 오른쪽의 검색 입력(동기화 상태 10 보다 오른쪽)
export const slots: FeatureSlots = {
  overlays: [CommandPalette],
  headerActions: [{ order: 100, Component: PaletteButton }]
}
