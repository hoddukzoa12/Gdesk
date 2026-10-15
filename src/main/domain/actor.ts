import type { ActorSummary } from '@shared/domain/actor'

/** GraphQL `Actor` 응답 조각 */
export interface RawActor {
  __typename?: string
  login?: string | null
  avatarUrl?: string | null
}

export const GHOST_LOGIN = 'ghost'

/** GitHub App 봇 계정인가: __typename 'Bot' 이거나 login 이 '[bot]' 으로 끝난다 */
export function isBotActor(raw: RawActor | null | undefined): boolean {
  if (!raw) return false
  if (raw.__typename === 'Bot') return true
  return typeof raw.login === 'string' && raw.login.toLowerCase().endsWith('[bot]')
}

/** 응답의 작성자를 요약한다. 지워진 계정(null)은 ghost */
export function toActor(raw: RawActor | null | undefined): ActorSummary {
  if (!raw || typeof raw.login !== 'string' || raw.login === '') {
    return { login: GHOST_LOGIN, avatarUrl: null, isBot: false }
  }
  return { login: raw.login, avatarUrl: raw.avatarUrl ?? null, isBot: isBotActor(raw) }
}
