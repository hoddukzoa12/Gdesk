import type { FeatureSlots } from '@renderer/app/slots'
import { CommandPalette } from './CommandPalette'
import { PaletteButton } from './PaletteButton'

// 빠른 검색창(⌘K / Ctrl+K)과 상단 막대의 검색 버튼
export const slots: FeatureSlots = {
  overlays: [CommandPalette],
  headerActions: [{ order: 10, Component: PaletteButton }]
}
