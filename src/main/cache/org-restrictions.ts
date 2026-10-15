import type { DatabaseSync } from 'node:sqlite'
import type { OrgRestrictionKind, OrgRestrictionNotice } from '@shared/domain/org'
import { withTransaction } from '../db/transaction'
import { num, str, strOrNull } from './rows'

/**
 * 조직 접근 제한 안내 (spec §5). 수집 중 OrgAccessRestrictedError·GraphQL orgRestrictions 를 만나면
 * 조직별로 기록한다(같은 조직은 최신 값으로 덮어쓴다). 조직을 알 수 없으면 한 줄로 모은다.
 */
export interface OrgRestrictionInput {
  reason: OrgRestrictionKind
  orgLogin?: string | null
  message: string
}

export function recordOrgRestrictions(
  db: DatabaseSync,
  restrictions: readonly OrgRestrictionInput[],
  now: number = Date.now()
): void {
  if (restrictions.length === 0) return
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO cache_org_restrictions (org_key, org_login, reason, message, recorded_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  withTransaction(db, () => {
    for (const r of restrictions) {
      const login = r.orgLogin ?? null
      stmt.run(login === null ? '' : login.toLowerCase(), login, r.reason, r.message, now)
    }
  })
}

/** 조직 접근 제한 목록(조직 이름 순, 이름 모름이 먼저) */
export function listOrgRestrictions(db: DatabaseSync): OrgRestrictionNotice[] {
  return db
    .prepare('SELECT * FROM cache_org_restrictions ORDER BY org_key')
    .all()
    .map((row) => ({
      orgLogin: strOrNull(row, 'org_login'),
      reason:
        str(row, 'reason') === 'saml_enforcement' ? 'saml_enforcement' : 'oauth_app_restriction',
      message: str(row, 'message'),
      recordedAt: num(row, 'recorded_at')
    }))
}

/** 제한 기록을 지운다. orgLogin 을 주면 그 조직만 */
export function clearOrgRestrictions(db: DatabaseSync, orgLogin?: string): void {
  if (orgLogin === undefined) db.exec('DELETE FROM cache_org_restrictions')
  else
    db.prepare('DELETE FROM cache_org_restrictions WHERE org_key = ?').run(orgLogin.toLowerCase())
}
