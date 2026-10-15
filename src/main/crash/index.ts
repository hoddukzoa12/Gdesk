import { homedir, release } from 'node:os'
import { app } from 'electron'
import '@shared/ipc/crash'
import { getAuthService, getToken } from '../auth'
import { GDESK_REPO } from '../config'
import { getDb, isDbReady } from '../db/db'
import { emit } from '../ipc/registry'
import type { ReportEnv } from './report'
import type { ScrubContext } from './scrub'
import { cachedScrubNames } from './scrub-context'
import { createCrashService, type CrashService } from './service'

/**
 * 오류 보고(spec §9). 처리되지 않은 오류를 잡아 지운 보고서를 만들고 창에 미리보기를 띄운다(crash:show).
 * 앱은 아무것도 직접 보내지 않는다. 사용자가 "보내기"를 눌러야 GitHub 이슈 페이지가 브라우저로 열린다.
 */

/** OS 버전. Electron 의 process.getSystemVersion()(예: macOS 15.1.0)이 있으면 쓰고, 없으면 커널 버전 */
function osVersion(): string {
  const getSystemVersion = (process as { getSystemVersion?: () => string }).getSystemVersion
  try {
    return getSystemVersion?.call(process) || release()
  } catch {
    return release()
  }
}

function reportEnv(): ReportEnv {
  return { appVersion: app.getVersion(), platform: process.platform, osVersion: osVersion() }
}

/** 지울 이름들. 로그인·DB 가 아직 준비되지 않았으면 그 부분만 비운다. */
function scrubContext(): ScrubContext {
  const ctx: ScrubContext & {
    repos: string[]
    owners: string[]
    repoNames: string[]
    secrets: string[]
  } = {
    homeDir: homedir(),
    login: null,
    repos: [],
    owners: [],
    repoNames: [],
    secrets: []
  }
  try {
    ctx.login = getAuthService().getSession().user?.login ?? null
  } catch {
    // 로그인 서비스 초기화 전
  }
  try {
    const token = getToken()
    if (token) ctx.secrets.push(token)
  } catch {
    // 토큰을 읽지 못해도 토큰 모양 지우기는 한다
  }
  try {
    if (isDbReady()) {
      // 캐시의 모든 저장소 전체 이름·소유자, 내 저장소는 이름만까지 지운다
      const names = cachedScrubNames(getDb())
      ctx.repos.push(...names.repos)
      ctx.owners.push(...names.owners)
      ctx.repoNames.push(...names.repoNames)
    }
  } catch {
    // DB 가 닫히는 중이면 이름 없이 지운다(경로·토큰·GitHub 주소는 그래도 지운다)
  }
  return ctx
}

let service: CrashService | null = null

/** 오류 보고 서비스(처음 부를 때 만든다). IPC 처리기와 프로세스 오류 처리기가 함께 쓴다. */
export function getCrashService(): CrashService {
  service ??= createCrashService({
    env: reportEnv,
    scrubContext,
    sendMode: () => (GDESK_REPO.trim() ? 'issue' : 'copy'),
    show: (report) => emit('crash:show', { report }),
    log: (text) => console.error(text)
  })
  return service
}

type ProcessEvents = Pick<NodeJS.EventEmitter, 'on' | 'off'>

let installed: {
  target: ProcessEvents
  onException: (e: unknown) => void
  onRejection: (r: unknown) => void
} | null = null

/**
 * 메인 프로세스의 처리되지 않은 오류·거부를 잡는다. 앱 시작 때 한 번, 가능한 한 일찍 부른다
 * (`app.whenReady()` 전에 불러도 된다. 로그인·DB 는 보고서를 만들 때 준비됐는지 확인한다).
 */
export function initCrashReporting(target: ProcessEvents = process): void {
  if (installed) return
  const onException = (error: unknown): void => {
    getCrashService().capture('main', error)
  }
  const onRejection = (reason: unknown): void => {
    getCrashService().capture('main', reason)
  }
  target.on('uncaughtException', onException)
  target.on('unhandledRejection', onRejection)
  installed = { target, onException, onRejection }
}

/** 테스트 전용 */
export function resetCrashReportingForTests(): void {
  if (installed) {
    installed.target.off('uncaughtException', installed.onException)
    installed.target.off('unhandledRejection', installed.onRejection)
  }
  installed = null
  service = null
}
