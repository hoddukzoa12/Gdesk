import type { LaunchCommand, Launcher } from './launch'

/** 화면 테스트 전용: 실제로 프로그램을 띄우지 않고 무엇을 열려 했는지만 기록한다. */
export interface RecordedLaunch {
  kind: 'spawn' | 'openPath'
  command?: LaunchCommand
  path?: string
}

const recorded: RecordedLaunch[] = []

export function createRecordingLauncher(): Launcher {
  return {
    spawnDetached: async (command) => {
      recorded.push({ kind: 'spawn', command })
    },
    openPath: async (path) => {
      recorded.push({ kind: 'openPath', path })
      return ''
    }
  }
}

export function recordedLaunches(): RecordedLaunch[] {
  return [...recorded]
}
