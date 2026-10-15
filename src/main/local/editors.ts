// 설치된 편집기 찾기(spec 4.10). 파일 시스템 접근은 DetectEnv 로 주입해 테스트한다.
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { AppPlatform } from '@shared/domain/app'
import type { EditorInfo } from '@shared/domain/local'

export interface DetectEnv {
  platform: AppPlatform
  homedir: string
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
  /** 폴더 안 이름 목록. 읽을 수 없으면 빈 배열 */
  listDir: (path: string) => string[]
}

/** 찾은 편집기. 실행은 `command ...args <폴더>` */
export interface DetectedEditor extends EditorInfo {
  command: string
  args: string[]
}

/** PATH 의 명령에서 실제 실행 파일을 찾는 규칙(Windows 의 code.cmd → Code.exe 등). */
interface WinPathRule {
  command: string
  /** 명령이 있는 폴더 기준 실행 파일 상대 경로 */
  exe: string
}

/** JetBrains 처럼 버전이 붙는 설치 폴더. `<root>\<prefix>*\bin\<exe>` */
interface WinVersionedRule {
  roots: string[]
  prefix: string
  exe: string
}

export interface EditorDefinition {
  id: string
  name: string
  /** macOS 앱 번들 이름. /Applications 와 ~/Applications 에서 찾는다 */
  mac?: string[]
  /** Windows 절대 경로. %VAR% 는 환경 변수로 바꾼다 */
  win?: string[]
  winPath?: WinPathRule[]
  winVersioned?: WinVersionedRule
  /** Linux PATH 의 명령 이름 */
  linux?: string[]
}

const JETBRAINS_ROOTS = ['%ProgramFiles%\\JetBrains', '%LOCALAPPDATA%\\Programs']

function jetbrains(
  id: string,
  name: string,
  macApps: string[],
  winPrefix: string,
  winExe: string,
  linux: string[]
): EditorDefinition {
  return {
    id,
    name,
    mac: macApps,
    winVersioned: { roots: JETBRAINS_ROOTS, prefix: winPrefix, exe: winExe },
    linux
  }
}

/** 찾을 편집기 목록(순서대로 보여 준다). 필요하면 여기에 더한다. */
export const EDITORS: readonly EditorDefinition[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    mac: ['Visual Studio Code.app'],
    win: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles%\\Microsoft VS Code\\Code.exe'
    ],
    winPath: [{ command: 'code.cmd', exe: '..\\Code.exe' }],
    linux: ['code']
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mac: ['Cursor.app'],
    win: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe'],
    winPath: [{ command: 'cursor.cmd', exe: '..\\..\\..\\Cursor.exe' }],
    linux: ['cursor']
  },
  {
    id: 'zed',
    name: 'Zed',
    mac: ['Zed.app'],
    win: ['%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe'],
    linux: ['zed', 'zeditor']
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    mac: ['Sublime Text.app'],
    win: [
      '%ProgramFiles%\\Sublime Text\\sublime_text.exe',
      '%ProgramFiles%\\Sublime Text 3\\sublime_text.exe'
    ],
    linux: ['subl']
  },
  jetbrains(
    'intellij-idea',
    'IntelliJ IDEA',
    ['IntelliJ IDEA.app', 'IntelliJ IDEA Ultimate.app', 'IntelliJ IDEA CE.app'],
    'IntelliJ IDEA',
    'idea64.exe',
    ['idea', 'intellij-idea-ultimate', 'intellij-idea-community', 'idea-community']
  ),
  jetbrains('webstorm', 'WebStorm', ['WebStorm.app'], 'WebStorm', 'webstorm64.exe', ['webstorm']),
  jetbrains(
    'pycharm',
    'PyCharm',
    ['PyCharm.app', 'PyCharm Professional Edition.app', 'PyCharm CE.app'],
    'PyCharm',
    'pycharm64.exe',
    ['pycharm', 'pycharm-professional', 'pycharm-community']
  ),
  jetbrains('goland', 'GoLand', ['GoLand.app'], 'GoLand', 'goland64.exe', ['goland']),
  jetbrains('clion', 'CLion', ['CLion.app'], 'CLion', 'clion64.exe', ['clion']),
  jetbrains('rider', 'Rider', ['Rider.app'], 'JetBrains Rider', 'rider64.exe', ['rider']),
  jetbrains('rubymine', 'RubyMine', ['RubyMine.app'], 'RubyMine', 'rubymine64.exe', ['rubymine']),
  jetbrains('phpstorm', 'PhpStorm', ['PhpStorm.app'], 'PhpStorm', 'phpstorm64.exe', ['phpstorm']),
  jetbrains('rustrover', 'RustRover', ['RustRover.app'], 'RustRover', 'rustrover64.exe', [
    'rustrover'
  ])
]

/** %VAR% 를 환경 변수로 바꾼다. 없는 변수가 있으면 null */
function expandWinVars(template: string, env: DetectEnv['env']): string | null {
  let missing = false
  const out = template.replace(/%([^%]+)%/g, (_, name: string) => {
    const value = env[name] ?? env[name.toUpperCase()]
    if (value === undefined || value === '') missing = true
    return value ?? ''
  })
  return missing ? null : out
}

function pathEnv(env: DetectEnv['env']): string {
  return env.PATH ?? env.Path ?? ''
}

/** PATH 에서 실행 파일을 찾아 절대 경로를 돌려준다. Windows 는 확장자를 붙여 넘긴다. */
export function findOnPath(name: string, detect: DetectEnv): string | null {
  const win = detect.platform === 'win32'
  const path = win ? win32 : posix
  for (const dir of pathEnv(detect.env).split(win ? ';' : ':')) {
    if (dir.trim() === '') continue
    const candidate = path.join(dir.trim(), name)
    if (path.isAbsolute(candidate) && detect.exists(candidate)) return candidate
  }
  return null
}

function detectMac(def: EditorDefinition, detect: DetectEnv): string | null {
  const roots = ['/Applications', posix.join(detect.homedir, 'Applications')]
  for (const app of def.mac ?? []) {
    for (const root of roots) {
      const full = posix.join(root, app)
      if (detect.exists(full)) return full
    }
  }
  return null
}

function detectWindows(def: EditorDefinition, detect: DetectEnv): string | null {
  for (const template of def.win ?? []) {
    const full = expandWinVars(template, detect.env)
    if (full !== null && detect.exists(full)) return full
  }
  for (const rule of def.winPath ?? []) {
    const command = findOnPath(rule.command, detect)
    if (command === null) continue
    const exe = win32.join(win32.dirname(command), rule.exe)
    if (detect.exists(exe)) return exe
  }
  const versioned = def.winVersioned
  if (versioned) {
    for (const template of versioned.roots) {
      const root = expandWinVars(template, detect.env)
      if (root === null) continue
      // 최신 버전을 먼저 고른다
      const dirs = detect
        .listDir(root)
        .filter((name) => name.startsWith(versioned.prefix))
        .sort()
        .reverse()
      for (const name of dirs) {
        const exe = win32.join(root, name, 'bin', versioned.exe)
        if (detect.exists(exe)) return exe
      }
    }
  }
  return null
}

function detectLinux(def: EditorDefinition, detect: DetectEnv): string | null {
  for (const command of def.linux ?? []) {
    const found = findOnPath(command, detect)
    if (found !== null) return found
  }
  return null
}

/** 설치된 편집기를 EDITORS 순서대로 돌려준다. */
export function detectEditors(
  detect: DetectEnv,
  editors: readonly EditorDefinition[] = EDITORS
): DetectedEditor[] {
  const out: DetectedEditor[] = []
  for (const def of editors) {
    const { id, name } = def
    if (detect.platform === 'darwin') {
      const app = detectMac(def, detect)
      if (app !== null) out.push({ id, name, command: 'open', args: ['-a', app] })
    } else if (detect.platform === 'win32') {
      const exe = detectWindows(def, detect)
      if (exe !== null) out.push({ id, name, command: exe, args: [] })
    } else {
      const bin = detectLinux(def, detect)
      if (bin !== null) out.push({ id, name, command: bin, args: [] })
    }
  }
  return out
}

/** 실제 환경 */
export function systemDetectEnv(): DetectEnv {
  return {
    platform: process.platform as AppPlatform,
    homedir: homedir(),
    env: process.env,
    exists: (p) => existsSync(p),
    listDir: (p) => {
      try {
        return readdirSync(p)
      } catch {
        return []
      }
    }
  }
}
