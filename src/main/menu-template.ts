import type { MenuItemConstructorOptions } from 'electron'
import type { LanguageSetting } from '@shared/domain/settings'

/**
 * 앱 메뉴 틀(Electron 없이 만드는 순수 함수). 모든 항목에 en·ko 문구를 직접 넣는다
 * (역할 메뉴의 기본 문구는 영어로만 나온다).
 * ⌘R / Ctrl+R 은 화면의 데이터 새로고침이 쓰므로 `reload`·`forceReload`·기본 `viewMenu` 를 넣지 않는다.
 */

export type MenuLanguage = 'en' | 'ko'

/** 설정 언어 → 메뉴 언어. system 이면 OS 언어(app.getLocale())가 ko 로 시작할 때 ko */
export function resolveMenuLanguage(setting: LanguageSetting, osLocale: string): MenuLanguage {
  if (setting === 'en' || setting === 'ko') return setting
  return osLocale.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

const LABELS = {
  en: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    about: 'About {app}',
    services: 'Services',
    hide: 'Hide {app}',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit {app}',
    close: 'Close Window',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    delete: 'Delete',
    selectAll: 'Select All',
    toggleDevTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    togglefullscreen: 'Toggle Full Screen',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring All to Front'
  },
  ko: {
    file: '파일',
    edit: '편집',
    view: '보기',
    window: '윈도우',
    about: '{app}에 관하여',
    services: '서비스',
    hide: '{app} 가리기',
    hideOthers: '기타 가리기',
    unhide: '모두 보기',
    quit: '{app} 종료',
    close: '윈도우 닫기',
    undo: '실행 취소',
    redo: '실행 복귀',
    cut: '오려두기',
    copy: '복사하기',
    paste: '붙여넣기',
    pasteAndMatchStyle: '붙여넣고 스타일 일치시키기',
    delete: '삭제',
    selectAll: '모두 선택',
    toggleDevTools: '개발자 도구 켜기/끄기',
    resetZoom: '실제 크기',
    zoomIn: '확대',
    zoomOut: '축소',
    togglefullscreen: '전체 화면 켜기/끄기',
    minimize: '최소화',
    zoom: '확대/축소',
    front: '모두 앞으로 가져오기'
  }
} as const satisfies Record<MenuLanguage, Record<string, string>>

export type MenuLabelKey = keyof (typeof LABELS)['en']

export interface MenuTemplateOptions {
  platform: NodeJS.Platform
  /** 포장된 앱이면 개발자 도구 항목을 뺀다 */
  isPackaged: boolean
  language: MenuLanguage
  appName: string
}

export function menuLabels(language: MenuLanguage, appName: string): Record<MenuLabelKey, string> {
  const source = LABELS[language]
  const out = {} as Record<MenuLabelKey, string>
  for (const key of Object.keys(source) as MenuLabelKey[]) {
    out[key] = source[key].replace('{app}', appName)
  }
  return out
}

export function buildMenuTemplate(options: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const isMac = options.platform === 'darwin'
  const L = menuLabels(options.language, options.appName)
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const appMenu: MenuItemConstructorOptions = {
    label: options.appName,
    submenu: [
      { role: 'about', label: L.about },
      sep,
      { role: 'services', label: L.services },
      sep,
      { role: 'hide', label: L.hide },
      { role: 'hideOthers', label: L.hideOthers },
      { role: 'unhide', label: L.unhide },
      sep,
      { role: 'quit', label: L.quit }
    ]
  }

  const fileMenu: MenuItemConstructorOptions = {
    label: L.file,
    submenu: [isMac ? { role: 'close', label: L.close } : { role: 'quit', label: L.quit }]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: L.edit,
    submenu: [
      { role: 'undo', label: L.undo },
      { role: 'redo', label: L.redo },
      sep,
      { role: 'cut', label: L.cut },
      { role: 'copy', label: L.copy },
      { role: 'paste', label: L.paste },
      ...(isMac ? [{ role: 'pasteAndMatchStyle', label: L.pasteAndMatchStyle } as const] : []),
      { role: 'delete', label: L.delete },
      sep,
      { role: 'selectAll', label: L.selectAll }
    ]
  }

  const viewItems: MenuItemConstructorOptions[] = [
    { role: 'resetZoom', label: L.resetZoom },
    { role: 'zoomIn', label: L.zoomIn },
    { role: 'zoomOut', label: L.zoomOut },
    sep,
    { role: 'togglefullscreen', label: L.togglefullscreen }
  ]
  if (!options.isPackaged) {
    viewItems.unshift({ role: 'toggleDevTools', label: L.toggleDevTools }, sep)
  }
  const viewMenu: MenuItemConstructorOptions = { label: L.view, submenu: viewItems }

  // 맥은 role 'windowMenu' 를 남겨 열린 창 목록이 이 메뉴에 붙게 한다(하위 항목은 직접 정한다)
  const windowMenu: MenuItemConstructorOptions = isMac
    ? {
        role: 'windowMenu',
        label: L.window,
        submenu: [
          { role: 'minimize', label: L.minimize },
          { role: 'zoom', label: L.zoom },
          sep,
          { role: 'front', label: L.front }
        ]
      }
    : {
        label: L.window,
        submenu: [
          { role: 'minimize', label: L.minimize },
          { role: 'close', label: L.close }
        ]
      }

  return [...(isMac ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu]
}
