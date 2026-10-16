import { describe, expect, it } from 'vitest'
import type { SessionSnapshot } from '@shared/domain/session'
import type { OrgRestrictionNotice } from '@shared/domain/org'
import {
  SCOPE_IMPACT_KEYS,
  authErrorKey,
  deviceFlowView,
  groupOrgRestrictions,
  isGateState,
  orgRestrictionsKey,
  profileUrl,
  tokenWarnings,
  tokenWarningsKey
} from './messages'
import en from '../../locales/en/auth.json'

const signedIn: SessionSnapshot = {
  state: 'signed_in',
  user: { id: 1, login: 'octo', name: null, avatarUrl: '', email: null },
  tokenKind: 'classic',
  missingScopes: [],
  inboxAvailable: true,
  deviceFlowAvailable: false
}

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en)
}

describe('isGateState', () => {
  it('로그아웃·로그인 중에만 관문을 띄운다', () => {
    expect(isGateState('signed_out')).toBe(true)
    expect(isGateState('signing_in')).toBe(true)
    expect(isGateState('signed_in')).toBe(false)
    expect(isGateState('expired')).toBe(false)
    expect(isGateState(undefined)).toBe(false)
  })
})

describe('authErrorKey', () => {
  it('오류 코드마다 번역 키가 있고 취소는 보여 주지 않는다', () => {
    for (const code of [
      'invalid_token',
      'empty_token',
      'offline',
      'http_error',
      'device_flow_unavailable'
    ] as const) {
      const key = authErrorKey(code)
      expect(typeof lookup(key ?? '')).toBe('string')
    }
    expect(authErrorKey('cancelled')).toBeNull()
  })
})

describe('SCOPE_IMPACT_KEYS', () => {
  it('모든 영향에 번역이 있다', () => {
    for (const key of Object.values(SCOPE_IMPACT_KEYS)) expect(typeof lookup(key)).toBe('string')
  })
})

describe('deviceFlowView', () => {
  const flow = { userCode: 'ABCD-1234', verificationUri: 'https://x', expiresAt: 1 }
  it('진행이 없거나 취소면 시작 단계', () => {
    expect(deviceFlowView(undefined)).toBe('idle')
    expect(deviceFlowView({ ...flow, status: 'cancelled' })).toBe('idle')
  })
  it('그 밖의 상태는 그대로', () => {
    expect(deviceFlowView({ ...flow, status: 'pending' })).toBe('pending')
    expect(deviceFlowView({ ...flow, status: 'expired' })).toBe('expired')
    expect(deviceFlowView({ ...flow, status: 'denied' })).toBe('denied')
    expect(deviceFlowView({ ...flow, status: 'error' })).toBe('error')
  })
})

describe('tokenWarnings', () => {
  it('권한이 다 있으면 안내하지 않는다', () => {
    expect(tokenWarnings(signedIn)).toBeNull()
    expect(tokenWarnings(undefined)).toBeNull()
  })

  it('세분화 토큰은 Inbox 사용 불가', () => {
    const w = tokenWarnings({ ...signedIn, tokenKind: 'fine_grained', inboxAvailable: false })
    expect(w).toEqual({ missing: [], inboxUnavailable: true, inboxReason: 'fine_grained' })
  })

  it('빠진 권한을 영향과 함께 돌려준다', () => {
    const session: SessionSnapshot = {
      ...signedIn,
      missingScopes: [
        { scope: 'read:org', impact: 'org_repos_and_team_reviews' },
        { scope: 'notifications', impact: 'inbox' }
      ],
      inboxAvailable: false
    }
    const w = tokenWarnings(session)
    expect(w?.missing.map((m) => m.scope)).toEqual(['read:org', 'notifications'])
    expect(w?.inboxReason).toBe('scope')
    expect(tokenWarningsKey(session, w!)).toBe('1|classic|read:org,notifications|no-inbox')
  })

  it('로그인 상태가 아니면 안내하지 않는다', () => {
    expect(tokenWarnings({ ...signedIn, state: 'expired', tokenKind: 'fine_grained' })).toBeNull()
  })
})

describe('groupOrgRestrictions', () => {
  const n = (orgLogin: string | null, reason: OrgRestrictionNotice['reason']) => ({
    orgLogin,
    reason,
    message: '',
    recordedAt: 0
  })

  it('이유별로 묶고 이름은 중복 없이 정렬한다', () => {
    const groups = groupOrgRestrictions([
      n('zeta', 'oauth_app_restriction'),
      n('acme', 'saml_enforcement'),
      n('alpha', 'oauth_app_restriction'),
      n('zeta', 'oauth_app_restriction'),
      n(null, 'saml_enforcement')
    ])
    expect(groups).toEqual([
      { reason: 'oauth_app_restriction', orgs: ['alpha', 'zeta'], hasUnknown: false },
      { reason: 'saml_enforcement', orgs: ['acme'], hasUnknown: true }
    ])
    expect(orgRestrictionsKey(groups)).toBe(
      'oauth_app_restriction:alpha,zeta:|saml_enforcement:acme:?'
    )
  })

  it('없으면 빈 목록', () => {
    expect(groupOrgRestrictions([])).toEqual([])
  })
})

describe('profileUrl', () => {
  it('GitHub 프로필 주소', () => {
    expect(profileUrl('octo-maintainer')).toBe('https://github.com/octo-maintainer')
  })
})
