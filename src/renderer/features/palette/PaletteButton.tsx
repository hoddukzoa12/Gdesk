import { useSyncExternalStore } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatform } from '@renderer/app/platform'
import { Button, Kbd, focusRing } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { openPalette } from './store'

/** 창 너비가 이보다 좁으면 검색 입력이 돋보기 아이콘 버튼으로 접힌다(px). */
export const SEARCH_COLLAPSE_WIDTH = 1100

const collapseQuery = `(max-width: ${SEARCH_COLLAPSE_WIDTH - 1}px)`

function subscribeCollapse(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(collapseQuery)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function isCollapsed(): boolean {
  // matchMedia 가 없는 환경(일부 테스트)에서는 넓은 창으로 본다
  return typeof window.matchMedia === 'function' && window.matchMedia(collapseQuery).matches
}

/** 창이 SEARCH_COLLAPSE_WIDTH 보다 좁은가. 창 크기가 바뀌면 다시 그린다. */
export function useSearchCollapsed(): boolean {
  return useSyncExternalStore(subscribeCollapse, isCollapsed, () => false)
}

/**
 * 상단 막대 맨 오른쪽의 검색 입력(spec §4.2). 입력처럼 보이는 버튼이고, 누르면 ⌘K / Ctrl+K 와 같은
 * 빠른 검색창을 연다. 좁은 창에서는 돋보기 아이콘 버튼으로 접힌다.
 */
export function PaletteButton() {
  const { t } = useTranslation('palette')
  const isMac = usePlatform() === 'darwin'
  const collapsed = useSearchCollapsed()
  const shortcut = isMac ? '⌘K' : 'Ctrl K'
  const label = t('open', { shortcut })

  if (collapsed) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={openPalette}
        aria-label={label}
        title={label}
        data-testid="palette-open-button"
        data-collapsed="true"
      >
        <Search aria-hidden />
      </Button>
    )
  }

  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-7 w-[300px] shrink-0 items-center gap-2 rounded-md border border-border bg-bg-subtle pr-1.5 pl-2.5',
        'text-left text-xs text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted',
        focusRing
      )}
      data-testid="palette-open-button"
      data-collapsed="false"
    >
      <Search size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t('trigger.placeholder')}</span>
      <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
        {isMac ? (
          <>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </>
        ) : (
          <>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </>
        )}
      </span>
    </button>
  )
}
