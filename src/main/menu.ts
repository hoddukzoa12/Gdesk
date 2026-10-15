import { Menu, app, type MenuItemConstructorOptions } from 'electron'

/**
 * 앱 메뉴. 기본 메뉴의 "다시 불러오기(⌘R / Ctrl+R)"는 화면 전체를 새로 고쳐 버리므로 빼고,
 * 그 단축키는 화면(사이드바)의 데이터 새로고침이 쓴다. 편집(복사·붙여넣기)·창 메뉴는 유지한다.
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const viewItems: MenuItemConstructorOptions[] = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
  if (!app.isPackaged) viewItems.unshift({ role: 'toggleDevTools' }, { type: 'separator' })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: viewItems },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
