/**
 * 조직이 이 앱을 막은 응답 알아보기 (spec §5).
 * 확실한 문구·헤더가 있을 때만 제한으로 본다. 알 수 없는 403 은 일반 오류로 둔다.
 */
export type OrgRestrictionReason = 'oauth_app_restriction' | 'saml_enforcement'

export interface OrgRestriction {
  reason: OrgRestrictionReason
  /** 문구·헤더에서 알아낼 수 있으면 조직 login */
  orgLogin?: string
  message: string
}

export interface OrgRestrictionInput {
  message: string
  /** `X-GitHub-SSO` 응답 헤더 */
  ssoHeader?: string | null
  /** GraphQL 오류 type. 주어지면 FORBIDDEN 일 때만 본다. */
  type?: string
}

const OAUTH_RESTRICTION = /OAuth App access restrictions/i
const SAML = /SAML (?:enforcement|SSO)/i
const ORG_IN_MESSAGE =
  /\bthe [`'"]?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)[`'"]? organization\b/i
const ORG_IN_SSO_URL = /\/orgs\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/sso\b/i

export function detectOrgRestriction(input: OrgRestrictionInput): OrgRestriction | null {
  if (input.type !== undefined && input.type !== 'FORBIDDEN') return null
  const { message } = input
  const sso = input.ssoHeader?.trim() ?? ''
  const ssoRequired = /^required\b/i.test(sso)

  let reason: OrgRestrictionReason | null = null
  if (OAUTH_RESTRICTION.test(message)) reason = 'oauth_app_restriction'
  else if (SAML.test(message) || ssoRequired) reason = 'saml_enforcement'
  if (!reason) return null

  const orgLogin =
    ORG_IN_MESSAGE.exec(message)?.[1] ??
    ORG_IN_SSO_URL.exec(sso)?.[1] ??
    ORG_IN_SSO_URL.exec(message)?.[1]
  return orgLogin ? { reason, orgLogin, message } : { reason, message }
}
