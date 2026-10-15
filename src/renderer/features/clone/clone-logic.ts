import type { AppPlatform } from '@shared/domain/app'
import type { LocalLink } from '@shared/domain/link'
import type { CloneFailureCode, LinkFailureReason, OpenFailureReason } from '@shared/domain/local'

/** 클론 실패 코드 전체(번역 키 검사용). shared 의 CloneFailureCode 와 같아야 한다. */
export const CLONE_FAILURE_CODES: readonly CloneFailureCode[] = [
  'signed_out',
  'session_expired',
  'offline',
  'rate_limited',
  'invalid_request',
  'invalid_target',
  'already_running',
  'auth_failed',
  'ssh_auth',
  'not_found',
  'network',
  'target_error',
  'git_error'
]

export const LINK_FAILURE_REASONS: readonly LinkFailureReason[] = [
  'link_not_found',
  'path_not_found',
  'not_git',
  'not_github',
  'different_repo',
  'unresolved'
]

export const OPEN_FAILURE_REASONS: readonly OpenFailureReason[] = [
  'link_not_found',
  'missing',
  'no_editor',
  'unknown_editor',
  'no_terminal',
  'launch_failed'
]

/** 클론 실패 코드 → `clone` 네임스페이스 번역 키. 모르는 코드는 git_error 문구로 */
export function cloneFailureKey(code: string): `cloneFailure.${CloneFailureCode}` {
  const known = (CLONE_FAILURE_CODES as readonly string[]).includes(code)
  return `cloneFailure.${known ? (code as CloneFailureCode) : 'git_error'}`
}

/** 연결 거부 이유 → 번역 키. 모르는 이유는 unresolved 문구로 */
export function linkFailureKey(reason: string): `linkFailure.${LinkFailureReason}` {
  const known = (LINK_FAILURE_REASONS as readonly string[]).includes(reason)
  return `linkFailure.${known ? (reason as LinkFailureReason) : 'unresolved'}`
}

/** 열기 실패 이유 → 번역 키. 모르는 이유는 launch_failed 문구로 */
export function openFailureKey(reason: string): `openFailure.${OpenFailureReason}` {
  const known = (OPEN_FAILURE_REASONS as readonly string[]).includes(reason)
  return `openFailure.${known ? (reason as OpenFailureReason) : 'launch_failed'}`
}

/** 경로 구분자. 플랫폼을 모르면 경로 모양으로 추측한다 */
export function pathSeparator(base: string, platform?: AppPlatform | null): '/' | '\\' {
  if (platform === 'win32') return '\\'
  if (platform === 'darwin' || platform === 'linux') return '/'
  return base.includes('\\') && !base.includes('/') ? '\\' : '/'
}

/**
 * 클론 대상 경로 `<base>/<name>`. 끝 구분자를 떼고 플랫폼 구분자로 잇는다.
 * "변경…"으로 고른 폴더도 base 로 넘긴다(고른 폴더 안에 저장소 이름 폴더를 만든다).
 */
export function cloneTargetPath(base: string, name: string, platform?: AppPlatform | null): string {
  const sep = pathSeparator(base, platform)
  const trimmed = base.replace(/[\\/]+$/, '')
  if (trimmed === '') return `${sep}${name}`
  return `${trimmed}${sep}${name}`
}

/** 클론 주소(spec §4.9 메뉴의 주소 복사). 웹 주소가 아니라 github.com 기준 */
export function httpsCloneUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`
}

export function sshCloneUrl(owner: string, name: string): string {
  return `git@github.com:${owner}/${name}.git`
}

/** 메뉴 버튼 모드: 연결이 하나라도 있으면 Open, 없으면 Clone */
export function menuMode(links: readonly LocalLink[] | undefined): 'clone' | 'open' {
  return links && links.length > 0 ? 'open' : 'clone'
}

/** 선택한 연결. 없거나 사라졌으면 가장 최근에 쓴 연결(links[0]) */
export function pickLink(
  links: readonly LocalLink[],
  selectedId: number | null
): LocalLink | undefined {
  return links.find((l) => l.id === selectedId) ?? links[0]
}

/** 파일 관리자 이름(메뉴 문구 키) */
export function fileManagerKey(
  platform: AppPlatform | null | undefined
): 'menu.showInFinder' | 'menu.showInExplorer' | 'menu.showInFiles' {
  if (platform === 'darwin') return 'menu.showInFinder'
  if (platform === 'win32') return 'menu.showInExplorer'
  return 'menu.showInFiles'
}

/** 진행률을 0~100 정수로 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
