import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import type { SettingsPatch } from '@shared/domain/settings'
import { Banner, PageHeader } from '@renderer/components'
import { AboutSection } from './AboutSection'
import { AccountSection } from './AccountSection'
import { AppearanceSection } from './AppearanceSection'
import { CloneSection } from './CloneSection'
import { HomeCardsSection } from './HomeCardsSection'
import { LinkedFoldersSection } from './LinkedFoldersSection'
import { useSettings, useUpdateSettings } from '@renderer/lib/hooks/useSettings'

/** 설정 화면(spec §4.13). 주소에 해시(#home-cards 등)가 있으면 그 항목으로 스크롤한다. */
export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { hash } = useLocation()
  const settings = useSettings()
  const update = useUpdateSettings()
  const [saveFailed, setSaveFailed] = useState(false)
  const loaded = settings.data !== undefined

  const save = useCallback(
    (patch: SettingsPatch) => {
      setSaveFailed(false)
      void update(patch).then((next) => {
        if (!next) setSaveFailed(true)
      })
    },
    [update]
  )

  // 해시 라우터라 브라우저의 기본 앵커 이동이 일어나지 않는다. 설정을 읽어 높이가 정해진 뒤에도 한 번 더 맞춘다.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [hash, loaded])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6" data-testid="settings-page">
      <PageHeader breadcrumb={[{ label: t('title') }]} />
      {saveFailed && (
        <Banner variant="error" onDismiss={() => setSaveFailed(false)}>
          {t('saveError')}
        </Banner>
      )}
      <AccountSection />
      <AppearanceSection />
      <CloneSection settings={settings.data} save={save} />
      <HomeCardsSection settings={settings.data} save={save} />
      <LinkedFoldersSection />
      <AboutSection />
    </div>
  )
}
