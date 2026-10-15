import { detectLanguage, type Language } from './i18n'

export const LANGUAGE_PREFERENCES = ['system', 'en', 'ko'] as const
/** 사용자가 고르는 언어 값. 기본은 `system`(OS 언어를 따름). */
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number]

/** 언어 설정과 OS 로캘로 실제 언어를 정한다. `system` 이면 OS 가 한국어일 때만 ko, 그 외 en. */
export function resolveLanguage(pref: LanguagePreference, osLocale: string | undefined): Language {
  if (pref === 'en' || pref === 'ko') return pref
  return detectLanguage(osLocale)
}
