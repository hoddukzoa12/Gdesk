// 로컬 폴더 연결·클론·열기의 앱 연결(Electron·싱글턴). 로직은 local.service.ts 에 있다.
import { shell } from 'electron'
import '@shared/ipc/local'
import { getAuthService, getToken } from '../auth'
import { getDb } from '../db/db'
import { isTestMode } from '../config'
import { cloneRepository, readGitHubRemotes } from '../git'
import { getGitHubClient } from '../github/client'
import { notifyDataChanged } from '../ipc/data-events'
import { emit } from '../ipc/registry'
import { getSettings, onSettingsChanged } from '../settings/settings.service'
import { systemDetectEnv } from './editors'
import { createProcessLauncher } from './launch'
import { LocalService } from './local.service'
import { createRecordingLauncher } from './test-launcher'
import type { LocalDeps } from './local.service'

export { LocalService } from './local.service'
export type { LocalDeps } from './local.service'

let service: LocalService | null = null
let unsubscribeSettings: (() => void) | null = null

/** 실제 앱의 의존성. 토큰은 HTTPS 클론 명령에만 넘기고 어디에도 기록하지 않는다. */
export function createDefaultLocalDeps(): LocalDeps {
  return {
    db: getDb,
    settings: () => getSettings(getDb()),
    readRemotes: (dir) => readGitHubRemotes(dir),
    clone: (options) => {
      // 화면 테스트 전용: 가짜 GitHub 의 git 저장소에서 클론한다(테스트 빌드 + 테스트 모드에서만).
      const testGitBase = isTestMode() ? process.env.GDESK_TEST_GIT_BASE : undefined
      return testGitBase
        ? cloneRepository(options, {
            sourceUrl: `${testGitBase.replace(/\/+$/, '')}/${options.owner}/${options.name}.git`
          })
        : cloneRepository(options)
    },
    sessionState: () => {
      try {
        return getAuthService().getSession().state
      } catch {
        return 'signed_out'
      }
    },
    connectionStatus: () => {
      try {
        return getGitHubClient().getStatus()
      } catch {
        return 'offline'
      }
    },
    lookupRepo: async (owner, name) => {
      // 이름이 바뀐 저장소는 GitHub 이 새 저장소로 리다이렉트하고 fetch 가 따라간다.
      const res = await getGitHubClient().get<{ id?: unknown }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
      )
      const id = res.data?.id
      return typeof id === 'number' ? id : null
    },
    token: getToken,
    notify: notifyDataChanged,
    onCloneProgress: (event) => emit('local:cloneProgress', event),
    // 화면 테스트에서는 실제 편집기·터미널을 띄우지 않고 기록만 한다.
    launcher: isTestMode()
      ? createRecordingLauncher()
      : createProcessLauncher((path) => shell.openPath(path)),
    detect: systemDetectEnv()
  }
}

/**
 * 앱 시작 때 한 번 부른다(startAuth 뒤). 시작 찾기를 뒤에서 돌리고,
 * 클론 기본 폴더 설정이 바뀌면 다시 찾는다. 시작을 막지 않는다.
 */
export function initLocal(options: { deps?: Partial<LocalDeps> } = {}): LocalService {
  unsubscribeSettings?.()
  const deps = { ...createDefaultLocalDeps(), ...options.deps }
  const next = new LocalService(deps)
  service = next

  let lastBase = deps.settings().cloneBaseDir
  unsubscribeSettings = onSettingsChanged((settings) => {
    if (settings.cloneBaseDir === lastBase) return
    lastBase = settings.cloneBaseDir
    void next.rescan().catch(() => undefined)
  })
  void next.rescan().catch(() => undefined)
  return next
}

export function getLocalService(): LocalService {
  if (!service) throw new Error('Local service is not initialized; call initLocal()')
  return service
}
