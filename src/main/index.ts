import { BrowserWindow, app } from 'electron'
import { isTestMode } from './config'
import { registerAllIpc } from './ipc/registry'
import { createMainWindow, installNavigationGuards } from './window'

// 화면 테스트는 분리된 사용자 데이터 폴더에서 실행한다.
if (isTestMode() && process.env.GDESK_TEST_USER_DATA) {
  app.setPath('userData', process.env.GDESK_TEST_USER_DATA)
}

app.setName('Gdesk')
installNavigationGuards()

app.whenReady().then(() => {
  // ── 서비스 초기화 (각 단계 끝의 연결 작업에서 여기에 추가) ──

  // ── IPC 등록 (src/main/**/*.ipc.ts 자동 수집) ──
  registerAllIpc()

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
