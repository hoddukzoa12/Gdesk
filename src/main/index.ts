import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { isTestMode } from './config'
import { closeDb, setupDatabase } from './db/db'
import { initCache } from './cache'
import { initAuth, startAuth, tokenProvider } from './auth'
import { createElectronTokenStore } from './auth/electron'
import { configureGitHubClient } from './github/client'
import { initUpdater } from './updater/updater'
import { registerAllIpc } from './ipc/registry'
import { createMainWindow, installNavigationGuards } from './window'

// 화면 테스트는 분리된 사용자 데이터 폴더에서 실행한다.
if (isTestMode() && process.env.GDESK_TEST_USER_DATA) {
  app.setPath('userData', process.env.GDESK_TEST_USER_DATA)
}

app.setName('Gdesk')
installNavigationGuards()

app.whenReady().then(async () => {
  // ── 서비스 초기화 (각 단계 끝의 연결 작업에서 여기에 추가) ──
  setupDatabase(join(app.getPath('userData'), 'gdesk.db'))
  initCache() // 로그아웃·계정 전환 시 캐시를 지우는 정리 함수 등록
  // safeStorage 는 ready 이후에만 동작한다. DB 다음, GitHub 클라이언트 전에 초기화.
  initAuth({ store: createElectronTokenStore() })
  const client = configureGitHubClient({ tokenProvider })

  // ── IPC 등록 (src/main/**/*.ipc.ts 자동 수집) ──
  registerAllIpc()

  // 401 구독 + 테스트 모드 자동 로그인(화면 테스트가 로그인 화면을 건너뛰도록 창 생성 전에 기다린다).
  await startAuth(client)

  createMainWindow()
  initUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('will-quit', () => {
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
