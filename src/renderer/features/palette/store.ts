import { useSyncExternalStore } from 'react'

// 빠른 검색창 열림 상태. ⌘K/Ctrl+K, 상단 막대의 검색 버튼이 같은 상태를 바꾼다.
let open = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export function openPalette(): void {
  set(true)
}

export function closePalette(): void {
  set(false)
}

export function togglePalette(): void {
  set(!open)
}

export function isPaletteOpen(): boolean {
  return open
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(subscribe, isPaletteOpen, isPaletteOpen)
}
