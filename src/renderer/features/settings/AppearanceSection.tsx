import { useTranslation } from 'react-i18next'
import { LANGUAGE_SETTINGS, THEME_SETTINGS } from '@shared/domain/settings'
import { usePreferences } from '@renderer/app/preferences'
import { Segmented, SettingRow, SettingsSection } from './ui'

/**
 * 화면: 언어·테마. 테마·언어 공급자를 거쳐 바꾸므로 바로 적용되고,
 * 공급자에 연결된 설정 슬롯(slots.tsx)이 저장한다.
 */
export function AppearanceSection() {
  const { t } = useTranslation('settings')
  const { theme, language, setTheme, setLanguage } = usePreferences()

  return (
    <SettingsSection id="appearance" title={t('appearance.title')}>
      <SettingRow
        label={t('appearance.language')}
        hint={t('appearance.languageHint')}
        labelId="settings-language-label"
      >
        <Segmented
          value={language}
          options={LANGUAGE_SETTINGS.map((value) => ({
            value,
            label: t(`appearance.languages.${value}`)
          }))}
          onChange={setLanguage}
          labelledBy="settings-language-label"
          testIdPrefix="settings-language"
        />
      </SettingRow>
      <SettingRow
        label={t('appearance.theme')}
        hint={t('appearance.themeHint')}
        labelId="settings-theme-label"
      >
        <Segmented
          value={theme}
          options={THEME_SETTINGS.map((value) => ({
            value,
            label: t(`appearance.themes.${value}`)
          }))}
          onChange={setTheme}
          labelledBy="settings-theme-label"
          testIdPrefix="settings-theme"
        />
      </SettingRow>
    </SettingsSection>
  )
}
