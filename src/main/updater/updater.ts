// 자동 업데이트 실제 연결: electron-updater 의 GitHub Releases 공급자만 쓴다(GitHub 외 서버 없음).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import '@shared/ipc/updater'
import { openExternalSafe } from '../app/external'
import { GDESK_REPO, isTestMode } from '../config'
import { emit } from '../ipc/registry'
import { decideUpdateMode, detectLinuxPackage, parseRepo, type RepoRef } from './mode'
import {
  createUpdaterService,
  type UpdateBackend,
  type UpdateBackendEvents,
  type UpdaterService
} from './service'

/** 맥 빌드가 서명됐는지. CI 가 인증서가 있을 때만 `GDESK_MAC_SIGNED=1` 로 빌드한다. */
const MAC_SIGNED: boolean = typeof __GDESK_MAC_SIGNED__ !== 'undefined' && __GDESK_MAC_SIGNED__

function readPackageType(): string | null {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8')
  } catch {
    return null
  }
}

function createElectronUpdaterBackend(
  mode: 'auto' | 'notify',
  repo: RepoRef,
  events: UpdateBackendEvents
): UpdateBackend {
  // notify 방식은 절대 내려받지 않는다(서명 안 된 맥은 Squirrel 이 설치를 거부한다).
  autoUpdater.autoDownload = mode === 'auto'
  autoUpdater.autoInstallOnAppQuit = mode === 'auto'
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo })

  autoUpdater.on('update-available', (info) => events.onAvailable(info.version))
  autoUpdater.on('update-not-available', () => events.onNotAvailable())
  autoUpdater.on('download-progress', (progress) => events.onProgress(progress.percent))
  autoUpdater.on('update-downloaded', (info) => events.onDownloaded(info.version))
  autoUpdater.on('error', (error) => events.onError(error))

  return {
    async check() {
      const result = await autoUpdater.checkForUpdates()
      if (!result) return null
      return { available: result.isUpdateAvailable, version: result.updateInfo.version }
    },
    install() {
      // IPC 응답을 먼저 돌려보낸 뒤 종료한다. 조용히 설치하고 다시 실행한다.
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
    }
  }
}

let service: UpdaterService | null = null

/** 업데이트 서비스(처음 부를 때 만든다). 만들기만 해서는 네트워크를 쓰지 않는다. */
export function getUpdater(): UpdaterService {
  if (service) return service
  const repo = parseRepo(GDESK_REPO)
  const decision = decideUpdateMode({
    platform: process.platform,
    packaged: app.isPackaged,
    macSigned: MAC_SIGNED,
    repoConfigured: repo !== null,
    testMode: isTestMode(),
    linuxPackage:
      process.platform === 'linux'
        ? detectLinuxPackage({ appImagePath: process.env.APPIMAGE, packageType: readPackageType() })
        : 'unknown'
  })
  service = createUpdaterService({
    decision,
    currentVersion: app.getVersion(),
    repo,
    createBackend: (mode, events) => {
      // decision 이 off 가 아니면 repo 가 있다
      if (!repo) throw new Error('GDESK_REPO is not configured')
      return createElectronUpdaterBackend(mode, repo, events)
    },
    openExternal: (url) => openExternalSafe(url, (safe) => shell.openExternal(safe)),
    onChange: (status) => emit('updater:status', status)
  })
  return service
}

/**
 * 백그라운드 업데이트 확인을 시작한다. 메인 창을 만든 뒤 한 번 부른다.
 * 개발 실행·테스트 모드·저장소 미설정이면 아무것도 하지 않는다.
 */
export function initUpdater(): void {
  getUpdater().start()
}
