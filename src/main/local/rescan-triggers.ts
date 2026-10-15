import type { SessionState } from '@shared/domain/session'
import type { Settings } from '@shared/domain/settings'

/** 세션에서 다시 찾기 판단에 쓰는 부분 */
export interface RescanSession {
  state: SessionState
  user: { id: number } | null
}

export interface RescanTriggerDeps {
  rescan: () => Promise<unknown>
  /** 지금 설정(클론 기본 폴더) */
  settings: () => Pick<Settings, 'cloneBaseDir'>
  onSettingsChanged: (listener: (settings: Pick<Settings, 'cloneBaseDir'>) => void) => () => void
  /** 지금 세션. 로그인 서비스 초기화 전이면 null */
  session: () => RescanSession | null
  onAuthChanged: (listener: (session: RescanSession) => void) => () => void
}

/**
 * 기본 클론 폴더 자동 찾기를 언제 뒤에서 다시 돌릴지 정한다(Electron 없음).
 * - 클론 기본 폴더 설정이 바뀌면
 * - 세션이 signed_in 이 되면(처음 로그인, 다시 로그인) 또는 signed_in 인 채로 계정이 바뀌면.
 *   계정 전환은 이전 계정의 연결을 지우므로 새 계정으로 다시 찾아야 한다.
 * 앱 시작 때의 첫 찾기는 부르는 쪽(initLocal)이 한다. 해제 함수를 돌려준다.
 */
export function watchRescanTriggers(deps: RescanTriggerDeps): () => void {
  const run = (): void => {
    void deps.rescan().catch(() => undefined)
  }
  let lastBase = deps.settings().cloneBaseDir
  const initial = deps.session()
  let lastState: SessionState | null = initial?.state ?? null
  let lastUserId: number | null = initial?.user?.id ?? null

  const offSettings = deps.onSettingsChanged((settings) => {
    if (settings.cloneBaseDir === lastBase) return
    lastBase = settings.cloneBaseDir
    run()
  })
  const offAuth = deps.onAuthChanged((session) => {
    const userId = session.user?.id ?? null
    const becameSignedIn = session.state === 'signed_in' && lastState !== 'signed_in'
    const switchedAccount = session.state === 'signed_in' && userId !== lastUserId
    lastState = session.state
    if (session.state === 'signed_in') lastUserId = userId
    if (becameSignedIn || switchedAccount) run()
  })
  return () => {
    offSettings()
    offAuth()
  }
}
