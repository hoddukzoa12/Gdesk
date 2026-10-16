import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveHomeSections, type ResolvedHomeSection } from '@shared/domain/homeCards'
import type { Settings, SettingsPatch } from '@shared/domain/settings'
import { Button } from '@renderer/components'
import { homeCardsPatch, moveHomeCard, toggleHomeCard } from './logic'
import { SettingsSection, Toggle } from './ui'

/**
 * 홈 카드: 영역 열 개(수치·고정 저장소·기여·최근 커밋·내 PR·할 일 카드 다섯)마다 켜기·끄기와 순서.
 * 바꿀 때마다 아는 ID 열 개의 전체 목록을 저장한다.
 */
export function HomeCardsSection({
  settings,
  save
}: {
  settings: Settings | undefined
  save: (patch: SettingsPatch) => void
}) {
  const { t } = useTranslation('settings')
  const { t: tHome } = useTranslation('home')
  const cards = resolveHomeSections(settings?.homeCards ?? [])
  const write = (next: ResolvedHomeSection[]): void => save(homeCardsPatch(next))

  return (
    <SettingsSection id="home-cards" title={t('homeCards.title')}>
      <p className="px-4 py-2 text-xs text-fg-muted">{t('homeCards.hint')}</p>
      <ol aria-label={t('homeCards.title')} data-testid="settings-home-cards">
        {cards.map((card, i) => {
          const name = tHome(`cards.${card.id}.title`)
          return (
            <li
              key={card.id}
              className="flex items-center gap-3 border-t border-border px-4 py-2 text-[13px]"
              data-testid={`settings-card-${card.id}`}
              data-enabled={card.enabled}
            >
              <Toggle
                checked={card.enabled}
                onCheckedChange={(enabled) => write(toggleHomeCard(cards, card.id, enabled))}
                label={t('homeCards.show', { name })}
                testId={`settings-card-${card.id}-toggle`}
              />
              <span className={card.enabled ? 'flex-1 text-fg' : 'flex-1 text-fg-subtle'}>
                {name}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={!settings || i === 0}
                aria-label={t('homeCards.moveUp', { name })}
                onClick={() => write(moveHomeCard(cards, card.id, -1))}
                data-testid={`settings-card-${card.id}-up`}
              >
                <ArrowUp />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={!settings || i === cards.length - 1}
                aria-label={t('homeCards.moveDown', { name })}
                onClick={() => write(moveHomeCard(cards, card.id, 1))}
                data-testid={`settings-card-${card.id}-down`}
              >
                <ArrowDown />
              </Button>
            </li>
          )
        })}
      </ol>
    </SettingsSection>
  )
}
