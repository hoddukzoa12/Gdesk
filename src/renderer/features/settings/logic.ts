import type { EditorInfo } from '@shared/domain/local'
import { isHomeCardId, resolveHomeCards, type ResolvedHomeCard } from '@shared/domain/homeCards'
import type { HomeCardSetting, Settings, SettingsPatch } from '@shared/domain/settings'
import type { Preferences } from '@renderer/app/preferences'

// 설정 화면의 순수 로직. 화면 컴포넌트와 테스트가 함께 쓴다.

// ───────────── 테마·언어 ─────────────

/** 저장된 설정에서 PreferencesProvider 에 넘길 값. 아직 못 읽었으면 undefined(공급자 기본값). */
export function settingsToPreferences(settings: Settings | undefined): Preferences | undefined {
  if (!settings) return undefined
  return { theme: settings.theme, language: settings.language }
}

/** 공급자가 알린 새 테마·언어에서 바뀐 항목만 담은 패치. 바뀐 게 없으면 null. */
export function preferencesPatch(
  current: Settings | undefined,
  next: Preferences
): SettingsPatch | null {
  const patch: SettingsPatch = {}
  if (current?.theme !== next.theme) patch.theme = next.theme
  if (current?.language !== next.language) patch.language = next.language
  return Object.keys(patch).length > 0 ? patch : null
}

// ───────────── 홈 카드 ─────────────

/** 카드 하나를 켜고 끈 새 목록. */
export function toggleHomeCard(
  cards: readonly ResolvedHomeCard[],
  id: string,
  enabled: boolean
): ResolvedHomeCard[] {
  return cards.map((c) => (c.id === id ? { ...c, enabled } : c))
}

/** 카드 하나를 위(-1)·아래(+1)로 한 칸 옮긴 새 목록. 끝이면 그대로. */
export function moveHomeCard(
  cards: readonly ResolvedHomeCard[],
  id: string,
  delta: -1 | 1
): ResolvedHomeCard[] {
  const from = cards.findIndex((c) => c.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= cards.length) return [...cards]
  const next = [...cards]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as ResolvedHomeCard)
  return next
}

/**
 * 저장할 홈 카드 패치. 아는 카드 다섯 개를 모두 순서대로 담는다
 * (모르는 ID·중복은 버리고, 빠진 카드는 켠 채로 끝에 붙인다).
 */
export function homeCardsPatch(cards: readonly HomeCardSetting[]): {
  homeCards: HomeCardSetting[]
} {
  const known = cards.filter((c) => isHomeCardId(c.id))
  const resolved = resolveHomeCards(known)
  return { homeCards: resolved.map(({ id, enabled }) => ({ id, enabled })) }
}

// ───────────── 편집기 ─────────────

export interface EditorOption {
  /** select 값. '' 은 "없음(자동)" */
  value: string
  /** 표시 이름. none 이면 화면이 번역한다 */
  label: string
  kind: 'none' | 'detected' | 'missing'
}

/**
 * 기본 편집기 선택지: "없음(자동)" + 찾은 편집기들.
 * 저장된 편집기가 지금 목록에 없으면 그 값도 넣어(missing) 선택이 엉뚱하게 보이지 않게 한다.
 */
export function editorOptions(
  editors: readonly EditorInfo[],
  current: string | null
): EditorOption[] {
  const options: EditorOption[] = [{ value: '', label: '', kind: 'none' }]
  for (const e of editors) options.push({ value: e.id, label: e.name, kind: 'detected' })
  if (current && !editors.some((e) => e.id === current)) {
    options.push({ value: current, label: current, kind: 'missing' })
  }
  return options
}

/** select 값을 설정 패치로. '' 은 null(자동). */
export function editorPatch(value: string): { defaultEditor: string | null } {
  return { defaultEditor: value === '' ? null : value }
}
