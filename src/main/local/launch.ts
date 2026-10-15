// 편집기·터미널·파일 관리자 실행. OS 별 명령은 순수 함수로 만들고, 실행은 Launcher 로 주입한다.
// 셸을 거치지 않고 인자 배열로만 넘긴다(경로에 특수 문자가 있어도 명령이 되지 않는다).
import { spawn } from 'node:child_process'
import type { AppPlatform } from '@shared/domain/app'

export interface LaunchCommand {
  command: string
  args: string[]
  cwd?: string
}

export interface Launcher {
  /** 분리된 프로세스로 띄운다. 띄우지 못하면 예외 */
  spawnDetached(command: LaunchCommand): Promise<void>
  /** 파일 관리자로 연다(Electron shell.openPath). 성공이면 '', 실패면 오류 문자열 */
  openPath(path: string): Promise<string>
}

/** 실행 파일 찾기(PATH). 없으면 null */
export type FindExecutable = (name: string) => string | null

/**
 * 터미널을 여는 명령. 찾지 못하면 null.
 * - macOS: open -a Terminal <경로>
 * - Windows: Windows Terminal(wt -d .) 을 작업 폴더에서, 없으면 cmd 의 start 로 새 창
 *   (경로를 인자로 넘기지 않고 작업 폴더로 넘겨 cmd·wt 의 인자 해석을 피한다)
 * - Linux: x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal 순
 */
export function terminalCommand(
  platform: AppPlatform,
  path: string,
  find: FindExecutable
): LaunchCommand | null {
  if (platform === 'darwin') return { command: 'open', args: ['-a', 'Terminal', path] }
  if (platform === 'win32') {
    const wt = find('wt.exe')
    if (wt !== null) return { command: wt, args: ['-d', '.'], cwd: path }
    return { command: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe'], cwd: path }
  }
  const candidates: [string, string[]][] = [
    ['x-terminal-emulator', []],
    ['gnome-terminal', [`--working-directory=${path}`]],
    ['konsole', ['--workdir', path]],
    ['xfce4-terminal', [`--working-directory=${path}`]]
  ]
  for (const [name, args] of candidates) {
    const command = find(name)
    if (command !== null) return { command, args, cwd: path }
  }
  return null
}

/** child_process 로 분리 실행하는 실제 Launcher. openPath 는 Electron 쪽에서 넘긴다. */
export function createProcessLauncher(openPath: (path: string) => Promise<string>): Launcher {
  return {
    spawnDetached: ({ command, args, cwd }) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: false
        })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      }),
    openPath
  }
}
