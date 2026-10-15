import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { i18n as I18n } from 'i18next'
import {
  getSystemPrefersDark,
  resolveTheme,
  subscribeSystemTheme,
  type ResolvedTheme,
  type ThemePreference
} from '../theme/theme'
import { i18n as appI18n, type Language } from './i18n'
import { resolveLanguage, type LanguagePreference } from './language'

export interface Preferences {
  theme: ThemePreference
  language: LanguagePreference
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', language: 'system' }

export interface PreferencesContextValue extends Preferences {
  resolvedTheme: ResolvedTheme
  resolvedLanguage: Language
  setTheme: (theme: ThemePreference) => void
  setLanguage: (language: LanguagePreference) => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export interface PreferencesProviderProps {
  /**
   * 바깥(설정 서비스)에서 주는 값. 주어지면 그 값을 따르고(제어 모드), 없거나 일부만 있으면
   * 빠진 항목은 내부 상태(기본 `system`)를 쓴다.
   */
  value?: Partial<Preferences>
  /** 사용자가 테마·언어를 바꿀 때 불린다. 저장은 호출한 쪽이 한다. */
  onChange?: (next: Preferences) => void
  /** 기본값 테스트용. 보통은 navigator.language. */
  osLocale?: string
  /** 기본값은 앱 i18n 인스턴스. */
  i18n?: I18n
  children: ReactNode
}

const browserLocale = (): string | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.language

/**
 * 테마·언어 공급자. `<html data-theme>` 와 `<html lang>` 을 붙이고, OS 테마 변경에 즉시 반응하며,
 * 언어가 바뀌면 i18n 을 바로 전환한다.
 */
export function PreferencesProvider({
  value,
  onChange,
  osLocale,
  i18n = appI18n,
  children
}: PreferencesProviderProps) {
  const [local, setLocal] = useState<Preferences>(DEFAULT_PREFERENCES)
  const theme = value?.theme ?? local.theme
  const language = value?.language ?? local.language

  const systemPrefersDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemPrefersDark,
    () => true
  )
  const resolvedTheme = resolveTheme(theme, systemPrefersDark)
  const resolvedLanguage = resolveLanguage(language, osLocale ?? browserLocale())

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  useLayoutEffect(() => {
    document.documentElement.lang = resolvedLanguage
    if (i18n.language !== resolvedLanguage) void i18n.changeLanguage(resolvedLanguage)
  }, [i18n, resolvedLanguage])

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      const next = { theme, language, ...patch }
      setLocal(next)
      onChange?.(next)
    },
    [theme, language, onChange]
  )

  const ctx = useMemo<PreferencesContextValue>(
    () => ({
      theme,
      language,
      resolvedTheme,
      resolvedLanguage,
      setTheme: (t) => update({ theme: t }),
      setLanguage: (l) => update({ language: l })
    }),
    [theme, language, resolvedTheme, resolvedLanguage, update]
  )

  return <PreferencesContext.Provider value={ctx}>{children}</PreferencesContext.Provider>
}

/** 현재 테마·언어와 바꾸는 함수. PreferencesProvider 안에서만 쓴다. */
export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>')
  return ctx
}
