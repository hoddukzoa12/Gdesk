import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatform } from '@renderer/app/platform'
import { Button, Kbd } from '@renderer/components'
import { openPalette } from './store'

/** 상단 막대의 검색 버튼. ⌘K / Ctrl+K 와 같은 검색창을 연다 */
export function PaletteButton() {
  const { t } = useTranslation('palette')
  const shortcut = usePlatform() === 'darwin' ? '⌘K' : 'Ctrl K'
  return (
    <Button
      variant="ghost"
      size="sm"
      className="app-no-drag text-fg-muted"
      onClick={openPalette}
      aria-label={t('open', { shortcut })}
      data-testid="palette-open-button"
    >
      <Search aria-hidden />
      <span>{t('button')}</span>
      <Kbd>{shortcut}</Kbd>
    </Button>
  )
}
