import type { LanguageSetting, ThemeSetting } from '@shared/domain/settings'
import type { CloneTarget } from '@renderer/features/clone'

/** 항목을 골랐을 때 할 일 */
export type PaletteAction =
  | { type: 'navigate'; path: string }
  | { type: 'refresh' }
  | { type: 'cloneMode' }
  | { type: 'theme'; value: ThemeSetting }
  | { type: 'language'; value: LanguageSetting }
  | { type: 'external'; url: string }
  | { type: 'clone'; target: CloneTarget }

export interface CommandDef {
  /** 테스트 ID 의 일부(`palette-item-command-<id>`) */
  id: string
  /** palette 네임스페이스의 문구 키 */
  labelKey: string
  /** 화면 언어와 상관없이 맞출 영어 낱말 */
  keywords: readonly string[]
  action: PaletteAction
}

const go = (id: string, path: string, keywords: string[]): CommandDef => ({
  id: `go-${id}`,
  labelKey: `commands.go.${id}`,
  keywords: ['go', ...keywords],
  action: { type: 'navigate', path }
})

/** 명령 목록(spec §4.12): 화면 이동, 새로고침, 저장소 클론, 테마·언어 변경, 설정 열기 */
export const COMMANDS: readonly CommandDef[] = [
  go('home', '/home', ['home']),
  go('inbox', '/inbox', ['inbox', 'notifications']),
  go('pulls', '/pulls', ['pull', 'requests', 'prs']),
  go('reviews', '/reviews', ['review', 'requests']),
  go('issues', '/issues', ['issues']),
  go('starred', '/starred', ['starred', 'stars']),
  go('repositories', '/repositories', ['repositories', 'repos']),
  go('settings', '/settings', ['settings', 'preferences']),
  {
    id: 'refresh',
    labelKey: 'commands.refresh',
    keywords: ['refresh', 'reload', 'sync'],
    action: { type: 'refresh' }
  },
  {
    id: 'clone',
    labelKey: 'commands.clone',
    keywords: ['clone', 'repository'],
    action: { type: 'cloneMode' }
  },
  ...(['dark', 'light', 'system'] as const).map((value): CommandDef => ({
    id: `theme-${value}`,
    labelKey: `commands.theme.${value}`,
    keywords: ['theme', 'appearance', value],
    action: { type: 'theme', value }
  })),
  ...(['en', 'ko', 'system'] as const).map((value): CommandDef => ({
    id: `language-${value}`,
    labelKey: `commands.language.${value}`,
    keywords: ['language', value === 'en' ? 'english' : value === 'ko' ? 'korean' : 'system'],
    action: { type: 'language', value }
  }))
]

/** 낱말마다(공백으로 나눔) 대소문자 없이 들어 있으면 맞다. 빈 검색어는 모두 맞다 */
export function matchesText(haystack: string, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const target = haystack.toLowerCase()
  return words.every((w) => target.includes(w))
}

export interface LabeledCommand extends CommandDef {
  label: string
}

/** 보이는 문구와 영어 낱말로 거른다. 순서는 목록 순서 그대로 */
export function filterCommands(
  commands: readonly LabeledCommand[],
  text: string
): LabeledCommand[] {
  return commands.filter((c) => matchesText(`${c.label} ${c.keywords.join(' ')}`, text))
}
