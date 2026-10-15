import { Menu, app } from 'electron'
import { getDb } from './db/db'
import { buildMenuTemplate, resolveMenuLanguage } from './menu-template'
import { getSettings, onSettingsChanged } from './settings/settings.service'
import type { LanguageSetting } from '@shared/domain/settings'

/**
 * 앱 메뉴. 기본 메뉴의 "다시 불러오기(⌘R / Ctrl+R)"는 화면 전체를 새로 고쳐 버리므로 빼고,
 * 그 단축키는 화면(사이드바)의 데이터 새로고침이 쓴다. 편집(복사·붙여넣기)·창 메뉴는 유지한다.
 * 문구는 설정의 언어(system 이면 OS 언어)를 따르고, 언어 설정이 바뀌면 다시 만든다.
 */

let unsubscribe: (() => void) | null = null
let current: LanguageSetting | null = null

function apply(setting: LanguageSetting): void {
  current = setting
  const template = buildMenuTemplate({
    platform: process.platform,
    isPackaged: app.isPackaged,
    language: resolveMenuLanguage(setting, app.getLocale()),
    appName: app.getName()
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** setupDatabase 뒤에 부른다(설정을 읽는다) */
export function installAppMenu(): void {
  let setting: LanguageSetting = 'system'
  try {
    setting = getSettings(getDb()).language
  } catch {
    // 설정을 읽지 못하면 OS 언어를 따른다
  }
  apply(setting)
  unsubscribe?.()
  unsubscribe = onSettingsChanged((settings) => {
    if (settings.language !== current) apply(settings.language)
  })
}
