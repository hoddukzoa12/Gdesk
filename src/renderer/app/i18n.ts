import i18next, { type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'

export const SUPPORTED_LANGUAGES = ['en', 'ko'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * 번역 자동 수집: `src/renderer/locales/<언어>/<네임스페이스>.json`.
 * 기능마다 자기 네임스페이스 파일(예: `inbox.json`)을 en·ko 둘 다 만든다. 이 파일은 고치지 않는다.
 */
const files = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json', {
  eager: true
})

function buildResources(): { resources: Resource; namespaces: string[] } {
  const resources: Resource = {}
  const namespaces = new Set<string>()
  for (const [path, mod] of Object.entries(files)) {
    const match = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
    if (!match) continue
    const [, lng, ns] = match as unknown as [string, string, string]
    resources[lng] ??= {}
    resources[lng][ns] = mod.default
    namespaces.add(ns)
  }
  return { resources, namespaces: [...namespaces] }
}

/** OS(브라우저) 언어로 기본 언어를 정한다: 한국어면 ko, 그 외 en. */
export function detectLanguage(locale: string | undefined): Language {
  return locale?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

const { resources, namespaces } = buildResources()

export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  resources,
  ns: namespaces,
  defaultNS: 'common',
  lng: detectLanguage(typeof navigator === 'undefined' ? undefined : navigator.language),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false
})
