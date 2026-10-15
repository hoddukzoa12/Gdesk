import type { LocalLink } from './link'
import type { RepoAccessStatus } from './repo'

/**
 * 로컬 폴더 연결·클론·열기(spec 4.10, 4.11). 화면은 code·reason 을 번역하고,
 * detail 은 그대로 보여 줄 수 있는 원문(git 오류 등, 토큰은 가려짐)이다.
 */

/** 설치된 편집기. id 는 설정의 defaultEditor 값으로 쓴다 */
export interface EditorInfo {
  id: string
  name: string
}

/** git 원격 하나. repo 는 github.com 저장소일 때만 있다 */
export interface LocalRemote {
  name: string
  url: string
  repo: { owner: string; name: string } | null
}

// ───────────── 클론 ─────────────

export interface CloneRequest {
  /** 화면이 만든 클론 ID. 진행률 이벤트와 취소에 쓴다 */
  cloneId: string
  repoId: number
  owner: string
  name: string
  /** 다른 위치에 클론할 때의 절대 경로. 없으면 `<클론 기본 폴더>/<저장소 이름>` */
  targetDir?: string
}

/**
 * 클론 실패 이유.
 * - signed_out: 로그인하지 않음 / session_expired: 세션 만료
 * - offline: 연결 없음 / rate_limited: GitHub 요청 한도 초과
 * - invalid_request: 잘못된 저장소 이름·ID / invalid_target: 대상 경로가 절대 경로가 아님 등
 * - already_running: 같은 cloneId 로 진행 중
 * - auth_failed: HTTPS 인증 실패 / ssh_auth: SSH 키·호스트 확인 실패
 * - not_found: 저장소가 없거나 접근 권한 없음 / network: 네트워크 오류
 * - target_error: 대상 폴더를 만들거나 쓸 수 없음 / git_error: 그 밖의 git 오류
 */
export type CloneFailureCode =
  | 'signed_out'
  | 'session_expired'
  | 'offline'
  | 'rate_limited'
  | 'invalid_request'
  | 'invalid_target'
  | 'already_running'
  | 'auth_failed'
  | 'ssh_auth'
  | 'not_found'
  | 'network'
  | 'target_error'
  | 'git_error'

export type CloneOutcome =
  /** 클론하고 자동으로 연결했다 */
  | { kind: 'cloned'; path: string; link: LocalLink }
  /**
   * 대상 폴더가 이미 있어 클론하지 않았다. sameRepo 면 '이 폴더 연결'(local:link)을 제안한다.
   * remotes 는 그 폴더가 git 저장소일 때의 원격들(아니면 빈 배열).
   */
  | { kind: 'exists'; path: string; remotes: LocalRemote[]; sameRepo: boolean }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: CloneFailureCode; detail: string }

export interface CloneProgressEvent {
  cloneId: string
  /** git 이 출력한 단계 이름(예: "Receiving objects") */
  phase: string
  /** 0~100 */
  percent: number
}

// ───────────── 연결 ─────────────

/**
 * 설정 화면 등에 보여 줄 연결(local:listLinks). accessStatus 는 캐시의 저장소 접근 상태다(spec §3).
 * 마지막 갱신에서 접근할 수 없다고 확인된 저장소면 unavailable(연결은 지우지 않는다).
 * 캐시에 없는 저장소(받아 본 적 없는 남의 저장소 등)는 available 로 본다.
 */
export interface LinkedFolder extends LocalLink {
  accessStatus: RepoAccessStatus
  /** 캐시가 아는 `소유자/이름`. 모르면 null(내 집합에서 빠진 저장소도 이름을 보여 주려고) */
  fullName: string | null
}

/**
 * 연결 거부 이유.
 * - link_not_found: 그런 연결이 없음(relink)
 * - path_not_found: 폴더가 없음
 * - not_git: git 작업 폴더의 최상위가 아님
 * - not_github: github.com 저장소를 가리키는 원격이 없음
 * - different_repo: 원격이 지정한 저장소와 다름
 * - unresolved: 원격의 저장소를 확인할 수 없음(오프라인·접근 불가 등)
 */
export type LinkFailureReason =
  'link_not_found' | 'path_not_found' | 'not_git' | 'not_github' | 'different_repo' | 'unresolved'

export type LinkOutcome =
  /** 연결된(또는 이미 있던) 연결들. 포크 클론은 원본·상위 저장소 둘 다 */
  { ok: true; links: LocalLink[] } | { ok: false; reason: LinkFailureReason }

export interface LinkRequest {
  /** 지정하면 원격이 이 저장소를 가리켜야 한다 */
  repoId?: number
  path: string
}

// ───────────── 열기 ─────────────

export type OpenTarget = 'editor' | 'terminal' | 'fileManager'

export interface OpenRequest {
  linkId: number
  target: OpenTarget
  /** 없으면 설정의 기본 편집기, 그것도 없으면 처음 찾은 편집기 */
  editorId?: string
}

/**
 * - link_not_found: 그런 연결이 없음
 * - missing: 폴더가 사라짐(연결을 missing 으로 표시했다 → '다시 연결')
 * - no_editor: 설치된 편집기를 찾지 못함 / unknown_editor: 지정한 편집기가 없음
 * - no_terminal: 터미널을 찾지 못함 / launch_failed: 실행 실패(detail)
 */
export type OpenFailureReason =
  'link_not_found' | 'missing' | 'no_editor' | 'unknown_editor' | 'no_terminal' | 'launch_failed'

export type OpenOutcome = { ok: true } | { ok: false; reason: OpenFailureReason; detail?: string }

// ───────────── 자동 찾기 ─────────────

export interface ScanSummary {
  /** 찾은 git 작업 폴더 수 */
  found: number
  /** 새로 만든 연결 수 */
  added: number
  /** 다시 확인 뒤 missing 인 연결 수 */
  missing: number
}
