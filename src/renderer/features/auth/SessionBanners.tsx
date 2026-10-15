import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/auth'
import { Banner, openExternal } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { useSession } from '@renderer/lib/hooks/useSession'
import { useSyncStatus } from '@renderer/lib/hooks/useSyncStatus'
import {
  CONNECTIONS_URL,
  ORG_REASON_KEYS,
  SCOPE_IMPACT_KEYS,
  TOKEN_CREATE_URL,
  groupOrgRestrictions,
  orgRestrictionsKey,
  tokenWarnings,
  tokenWarningsKey
} from './messages'

/**
 * 세션 만료(spec §5): 저장된 정보는 읽기 전용으로 계속 보인다. "다시 로그인" 을 누를 때만
 * 로그아웃해 로그인 화면을 띄운다(화면이 뜰 때 저절로 로그아웃하지 않는다).
 */
export function SessionExpiredBanner() {
  const { t } = useTranslation('auth')
  const session = useSession()
  if (session?.state !== 'expired') return null
  return (
    <div data-testid="session-expired-banner">
      <Banner
        variant="warning"
        title={t('expired.title')}
        action={{
          label: t('expired.action'),
          onClick: () => void invoke('auth:logout').catch(() => {})
        }}
      />
    </div>
  )
}

/** 빠진 권한·Inbox 사용 불가 안내. 닫으면 같은 계정·권한 조합에서는 이번 실행 동안 다시 띄우지 않는다. */
export function TokenWarningBanner() {
  const { t } = useTranslation('auth')
  const session = useSession()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const warnings = tokenWarnings(session)
  if (!session || !warnings) return null
  const key = tokenWarningsKey(session, warnings)
  if (dismissed === key) return null

  const title =
    warnings.missing.length > 0 ? t('scopes.titleMissing') : t('scopes.titleInboxUnavailable')

  return (
    <div data-testid="token-warning-banner">
      <Banner
        variant="warning"
        title={title}
        action={{ label: t('scopes.action'), onClick: () => void openExternal(TOKEN_CREATE_URL) }}
        onDismiss={() => setDismissed(key)}
      >
        {warnings.missing.map((m) => (
          <span key={m.scope} className="block">
            <code className="font-mono text-fg">{m.scope}</code>
            {': '}
            {t(SCOPE_IMPACT_KEYS[m.impact])}
          </span>
        ))}
        {warnings.inboxReason === 'fine_grained' && (
          <span className="block">{t('scopes.fineGrained')}</span>
        )}
        {warnings.inboxReason === 'other' && warnings.missing.length > 0 && (
          <span className="block">{t('scopes.titleInboxUnavailable')}</span>
        )}
      </Banner>
    </div>
  )
}

/** 조직이 이 앱의 접근을 막았을 때의 안내. 닫으면 같은 조직 목록은 이번 실행 동안 다시 띄우지 않는다. */
export function OrgRestrictionBanner() {
  const { t } = useTranslation('auth')
  const session = useSession()
  const status = useSyncStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (session?.state !== 'signed_in' && session?.state !== 'expired') return null
  const groups = groupOrgRestrictions(status?.orgRestrictions ?? [])
  if (groups.length === 0) return null
  const key = orgRestrictionsKey(groups)
  if (dismissed === key) return null

  return (
    <div data-testid="org-restriction-banner">
      <Banner
        variant="info"
        title={t('org.title')}
        action={{ label: t('org.action'), onClick: () => void openExternal(CONNECTIONS_URL) }}
        onDismiss={() => setDismissed(key)}
      >
        {groups.map((g) => {
          const names = [...g.orgs, ...(g.hasUnknown ? [t('org.unknownOrg')] : [])].join(', ')
          return (
            <span key={g.reason} className="block">
              <span className="font-medium text-fg">{names}</span>
              {': '}
              {t(ORG_REASON_KEYS[g.reason])}
            </span>
          )
        })}
      </Banner>
    </div>
  )
}
