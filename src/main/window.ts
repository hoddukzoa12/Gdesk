import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { isSafeExternalUrl } from './app/external'

/** 메인 창을 만든다. 화면은 격리(contextIsolation·sandbox)되고 Node 기능을 쓰지 못한다. */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Gdesk',
    backgroundColor: '#0d0f12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/**
 * 모든 웹 콘텐츠에 이동·새 창 제한을 건다(spec 11-8).
 * 앱 창 안에서 다른 페이지로 이동하지 못하고, 새 창 요청은 http(s)면 기본 브라우저로 넘긴다.
 */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      // 개발 서버 주소는 포장되지 않은 개발 실행에서만 허용한다. 배포 앱에서는 환경 변수로
      // 앱 창의 이동 허용 범위를 넓힐 수 없다.
      const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
      if (devUrl && url.startsWith(devUrl)) return
      event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
