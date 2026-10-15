/** 설정(spec 4.13). 계정과 무관하며 계정을 바꿔도 지우지 않는다. */

export const CLONE_PROTOCOLS = ['https', 'ssh'] as const
export type CloneProtocol = (typeof CLONE_PROTOCOLS)[number]

export const LANGUAGE_SETTINGS = ['system', 'en', 'ko'] as const
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number]

export const THEME_SETTINGS = ['system', 'dark', 'light'] as const
export type ThemeSetting = (typeof THEME_SETTINGS)[number]

/** 홈 카드 하나의 표시 여부. 카드 ID 목록은 홈 화면이 정한다. */
export interface HomeCardSetting {
  id: string
  enabled: boolean
}

export interface Settings {
  /** 클론 기본 폴더(절대 경로). 기본값은 실행 시 계산하는 `<홈>/GitHub` */
  cloneBaseDir: string
  cloneProtocol: CloneProtocol
  /** 기본 편집기 ID. 없으면 null */
  defaultEditor: string | null
  language: LanguageSetting
  theme: ThemeSetting
  /** 홈 카드 순서·표시. 빈 배열이면 홈 화면의 기본 순서를 쓴다 */
  homeCards: HomeCardSetting[]
}

export type SettingsKey = keyof Settings

export const SETTINGS_KEYS: readonly SettingsKey[] = [
  'cloneBaseDir',
  'cloneProtocol',
  'defaultEditor',
  'language',
  'theme',
  'homeCards'
]

/** 일부 필드만 바꾸는 패치 */
export type SettingsPatch = Partial<Settings>
