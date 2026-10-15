import type {
  AuthErrorCode,
  DeviceFlowProgress,
  MissingScope,
  ScopeImpact,
  SessionSnapshot,
  SessionState
} from '@shared/domain/session'
import type { OrgRestrictionKind, OrgRestrictionNotice } from '@shared/domain/org'

/**
 * 로그인·세션 화면의 순수 계산(번역 키 고르기, 배너에 넣을 내용). 컴포넌트와 분리해 단위 테스트한다.
 */

/** classic 토큰 만들기 페이지(필요한 권한이 미리 체크됨) */
export const TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org,notifications&description=Gdesk'

/** 승인한 앱 목록(조직 접근 요청·SAML 승인) */
export const CONNECTIONS_URL = 'https://github.com/settings/connections/applications/'

export function profileUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`
}

/** 로그인 화면이 앱 전체를 덮어야 하는 상태 */
export function isGateState(state: SessionState | undefined): boolean {
  return state === 'signed_out' || state === 'signing_in'
}

/** 권한이 빠졌을 때 동작하지 않는 기능 → 번역 키 */
export const SCOPE_IMPACT_KEYS: Record<ScopeImpact, string> = {
  private_repos_and_star: 'scopes.impact.privateReposAndStar',
  org_repos_and_team_reviews: 'scopes.impact.orgReposAndTeamReviews',
  inbox: 'scopes.impact.inbox'
}

/** 로그인 실패 → 번역 키. 취소는 사용자가 한 일이라 보여 주지 않는다(null). */
export function authErrorKey(code: AuthErrorCode): string | null {
  switch (code) {
    case 'invalid_token':
      return 'errors.invalidToken'
    case 'empty_token':
      return 'errors.emptyToken'
    case 'offline':
      return 'errors.offline'
    case 'http_error':
      return 'errors.httpError'
    case 'device_flow_unavailable':
      return 'errors.deviceFlowUnavailable'
    case 'cancelled':
      return null
  }
}

/** 기기 인증 패널이 보여 줄 단계. 진행이 없거나 취소했으면 시작 버튼(idle). */
export type DeviceFlowView = 'idle' | 'requesting' | 'pending' | 'expired' | 'denied' | 'error'

export function deviceFlowView(flow: DeviceFlowProgress | undefined): DeviceFlowView {
  if (!flow || flow.status === 'cancelled') return 'idle'
  return flow.status
}

export interface TokenWarnings {
  /** 빠진 권한과 그 영향 */
  missing: MissingScope[]
  /** 이 토큰으로는 Inbox 가 동작하지 않는다 */
  inboxUnavailable: boolean
  /** Inbox 가 안 되는 이유. 빠진 권한 목록에 이미 나오면 'scope' */
  inboxReason: 'fine_grained' | 'scope' | 'other' | null
}

/** 로그인 뒤 권한 안내 배너의 내용. 보여 줄 것이 없으면 null. */
export function tokenWarnings(session: SessionSnapshot | undefined): TokenWarnings | null {
  if (!session || session.state !== 'signed_in') return null
  const missing = session.missingScopes
  const inboxUnavailable = session.tokenKind === 'fine_grained' || !session.inboxAvailable
  if (missing.length === 0 && !inboxUnavailable) return null
  let inboxReason: TokenWarnings['inboxReason'] = null
  if (inboxUnavailable) {
    if (session.tokenKind === 'fine_grained') inboxReason = 'fine_grained'
    else if (missing.some((m) => m.impact === 'inbox')) inboxReason = 'scope'
    else inboxReason = 'other'
  }
  return { missing, inboxUnavailable, inboxReason }
}

/** 같은 내용이면 다시 띄우지 않기 위한 열쇠(계정·토큰 종류·권한이 바뀌면 다시 보인다). */
export function tokenWarningsKey(session: SessionSnapshot, w: TokenWarnings): string {
  return [
    session.user?.id ?? '',
    session.tokenKind ?? '',
    w.missing.map((m) => m.scope).join(','),
    w.inboxUnavailable ? 'no-inbox' : ''
  ].join('|')
}

export interface OrgRestrictionGroup {
  reason: OrgRestrictionKind
  /** 이름을 아는 조직(중복 제거, 이름순) */
  orgs: string[]
  /** 이름을 모르는 조직이 있었는가 */
  hasUnknown: boolean
}

const REASON_ORDER: OrgRestrictionKind[] = ['oauth_app_restriction', 'saml_enforcement']

/** 조직 접근 제한 안내를 이유별로 묶는다. */
export function groupOrgRestrictions(list: OrgRestrictionNotice[]): OrgRestrictionGroup[] {
  const groups: OrgRestrictionGroup[] = []
  for (const reason of REASON_ORDER) {
    const items = list.filter((n) => n.reason === reason)
    if (items.length === 0) continue
    const orgs = [...new Set(items.map((n) => n.orgLogin).filter((o): o is string => !!o))].sort(
      (a, b) => a.localeCompare(b)
    )
    groups.push({ reason, orgs, hasUnknown: items.some((n) => !n.orgLogin) })
  }
  return groups
}

export function orgRestrictionsKey(groups: OrgRestrictionGroup[]): string {
  return groups.map((g) => `${g.reason}:${g.orgs.join(',')}:${g.hasUnknown ? '?' : ''}`).join('|')
}

export const ORG_REASON_KEYS: Record<OrgRestrictionKind, string> = {
  oauth_app_restriction: 'org.reason.oauthApp',
  saml_enforcement: 'org.reason.saml'
}
