import { describe, expect, it } from 'vitest'
import { detectOrgRestriction } from './org-restriction'

const OAUTH_MSG =
  'Although you appear to have the correct authorization credentials, the `acme` organization has ' +
  'enabled OAuth App access restrictions, meaning that data access to third-parties is limited. ' +
  'For more information on these restrictions, including how to enable this app, visit ' +
  'https://docs.github.com/articles/restricting-access-to-your-organization-s-data/'

describe('detectOrgRestriction', () => {
  it('OAuth App 접근 제한 문구에서 조직 이름을 뽑는다', () => {
    expect(detectOrgRestriction({ message: OAUTH_MSG })).toEqual({
      reason: 'oauth_app_restriction',
      orgLogin: 'acme',
      message: OAUTH_MSG
    })
  })

  it('조직 이름을 못 뽑아도 제한으로 본다', () => {
    const r = detectOrgRestriction({
      message: 'This org has enabled OAuth App access restrictions.'
    })
    expect(r?.reason).toBe('oauth_app_restriction')
    expect(r?.orgLogin).toBeUndefined()
  })

  it('SAML 강제 문구와 X-GitHub-SSO 헤더에서 조직을 뽑는다', () => {
    const r = detectOrgRestriction({
      message:
        'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
      ssoHeader: 'required; url=https://github.com/orgs/big-corp/sso?authorization_request=abc'
    })
    expect(r).toMatchObject({ reason: 'saml_enforcement', orgLogin: 'big-corp' })
  })

  it('SSO 헤더만 있어도 SAML 로 본다', () => {
    const r = detectOrgRestriction({
      message: 'Forbidden',
      ssoHeader: 'required; url=https://github.com/orgs/octo/sso?authorization_request=x'
    })
    expect(r).toMatchObject({ reason: 'saml_enforcement', orgLogin: 'octo' })
  })

  it('알 수 없는 403 은 제한이 아니다', () => {
    expect(detectOrgRestriction({ message: 'Resource not accessible by integration' })).toBeNull()
    expect(detectOrgRestriction({ message: 'Must have admin rights to Repository.' })).toBeNull()
    expect(
      detectOrgRestriction({
        message: 'Forbidden',
        ssoHeader: 'partial-results; organizations=1,2'
      })
    ).toBeNull()
  })

  it('GraphQL 오류는 FORBIDDEN 유형만 본다', () => {
    expect(detectOrgRestriction({ message: OAUTH_MSG, type: 'FORBIDDEN' })?.orgLogin).toBe('acme')
    expect(detectOrgRestriction({ message: OAUTH_MSG, type: 'NOT_FOUND' })).toBeNull()
  })
})
