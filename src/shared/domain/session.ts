/**
 * 로그인 세션(spec §5). 화면으로 가는 값이다. 토큰은 절대 여기에 담지 않는다.
 */

export type SessionState = 'signed_out' | 'signing_in' | 'signed_in' | 'expired'

/** classic: 기본 개인 토큰, fine_grained: 세분화 토큰(github_pat_), oauth: 브라우저 코드 로그인(gho_) */
export type TokenKind = 'classic' | 'fine_grained' | 'oauth'

/** 앱이 요청하는 권한 */
export const REQUIRED_SCOPES = ['repo', 'read:org', 'notifications'] as const
export type RequiredScope = (typeof REQUIRED_SCOPES)[number]

/**
 * 권한이 없을 때 동작하지 않는 기능. 화면이 번역해 보여 준다.
 * - private_repos_and_star: 비공개 저장소, 별표(star)
 * - org_repos_and_team_reviews: 조직 저장소, 팀 리뷰 요청
 * - inbox: 알림(Inbox)
 */
export type ScopeImpact = 'private_repos_and_star' | 'org_repos_and_team_reviews' | 'inbox'

export interface MissingScope {
  scope: RequiredScope
  impact: ScopeImpact
}

export interface SessionUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string
}

/**
 * 기기 인증 진행 상태.
 * - requesting: 코드를 받는 중
 * - pending: 코드를 보여 주고 사용자의 승인을 기다리는 중
 * - expired: 코드가 만료됨
 * - denied: 사용자가 거부함
 * - cancelled: 사용자가 취소함
 * - error: 그 밖의 실패(네트워크·설정 문제)
 */
export type DeviceFlowStatus =
  'requesting' | 'pending' | 'expired' | 'denied' | 'cancelled' | 'error'

export interface DeviceFlowProgress {
  /** requesting 일 때는 빈 문자열 */
  userCode: string
  verificationUri: string
  /** ms, epoch. requesting 일 때는 0 */
  expiresAt: number
  status: DeviceFlowStatus
}

/** 리눅스에서 키링이 없어 안전하게 암호화할 수 없을 때 사용자에게 고르게 한다. */
export type StoragePrompt = 'linux_insecure'

/** (a) 그래도 저장(소유자만 읽는 0600 파일) / (b) 이번 실행에만 메모리에 둔다 */
export type InsecureStorageChoice = 'save' | 'memory'

/** 조직이 앱 접근을 막은 경우의 안내(후속 작업이 채운다) */
export interface SessionOrgRestriction {
  orgLogin?: string
  reason: string
}

export interface SessionSnapshot {
  state: SessionState
  user: SessionUser | null
  tokenKind: TokenKind | null
  missingScopes: MissingScope[]
  /** 세분화 토큰이거나 notifications 권한이 없으면 false */
  inboxAvailable: boolean
  /** 브라우저 코드 로그인을 보여 줄지(빌드에 client ID 가 있을 때만 true) */
  deviceFlowAvailable: boolean
  deviceFlow?: DeviceFlowProgress
  storagePrompt?: StoragePrompt
  orgRestrictions?: SessionOrgRestriction[]
}

/** 로그인 실패 이유. 화면이 번역한다. 토큰·원문 오류는 담지 않는다. */
export type AuthErrorCode =
  | 'invalid_token'
  | 'empty_token'
  | 'offline'
  | 'http_error'
  | 'device_flow_unavailable'
  | 'cancelled'

export type AuthResult =
  | { ok: true; session: SessionSnapshot }
  | { ok: false; error: AuthErrorCode; session: SessionSnapshot }
