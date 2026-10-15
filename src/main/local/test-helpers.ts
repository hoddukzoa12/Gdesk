// 테스트 전용 도우미. 앱 코드에서 import 하지 않는다.
import { mkdir } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { CloneProgressEvent } from '@shared/domain/local'
import type { SessionState } from '@shared/domain/session'
import type { Settings } from '@shared/domain/settings'
import { upsertRepositories } from '../cache'
import { repoRecord } from '../cache/test-fixtures'
import { openDatabase } from '../db/connection'
import { readGitHubRemotes } from '../git'
import type { CloneOptions, CloneResult } from '../git'
import { git } from '../git/test-helpers'
import type { DetectEnv } from './editors'
import type { LaunchCommand, Launcher } from './launch'
import { LocalService } from './local.service'
import type { LocalDeps } from './local.service'

export interface HarnessState {
  session: SessionState
  status: ConnectionStatus
  settings: Settings
  token: string | null
  /** GitHub API 가짜 응답: 'owner/name'(소문자) → 저장소 ID */
  api: Map<string, number>
  cloneResult: (options: CloneOptions) => Promise<CloneResult>
  /** openPath 가 돌려줄 오류 문자열('' 이면 성공) */
  openPathError: string
}

export interface Harness {
  service: LocalService
  db: DatabaseSync
  state: HarnessState
  spawned: LaunchCommand[]
  openedPaths: string[]
  notified: string[][]
  progress: CloneProgressEvent[]
  lookups: string[]
  clones: CloneOptions[]
}

export function createHarness(
  options: { baseDir?: string; deps?: Partial<LocalDeps>; detect?: Partial<DetectEnv> } = {}
): Harness {
  const db = openDatabase(':memory:')
  const state: HarnessState = {
    session: 'signed_in',
    status: 'online',
    settings: {
      cloneBaseDir: options.baseDir ?? '/gdesk-nonexistent-base',
      cloneProtocol: 'https',
      defaultEditor: null,
      language: 'system',
      theme: 'system',
      homeCards: []
    },
    token: 'ghp_HarnessSecretToken000000000000000',
    api: new Map(),
    cloneResult: async () => ({ kind: 'cancelled' }),
    openPathError: ''
  }
  const spawned: LaunchCommand[] = []
  const openedPaths: string[] = []
  const notified: string[][] = []
  const progress: CloneProgressEvent[] = []
  const lookups: string[] = []
  const clones: CloneOptions[] = []

  const launcher: Launcher = {
    spawnDetached: async (command) => {
      spawned.push(command)
    },
    openPath: async (path) => {
      openedPaths.push(path)
      return state.openPathError
    }
  }

  const deps: LocalDeps = {
    db: () => db,
    settings: () => state.settings,
    readRemotes: (dir) => readGitHubRemotes(dir),
    clone: (cloneOptions) => {
      clones.push(cloneOptions)
      return state.cloneResult(cloneOptions)
    },
    sessionState: () => state.session,
    connectionStatus: () => state.status,
    lookupRepo: async (owner, name) => {
      const key = `${owner}/${name}`.toLowerCase()
      lookups.push(key)
      return state.api.get(key) ?? null
    },
    token: () => state.token,
    notify: (keys) => notified.push(keys),
    onCloneProgress: (event) => progress.push(event),
    launcher,
    detect: {
      platform: 'darwin',
      homedir: '/Users/tester',
      env: {},
      exists: () => false,
      listDir: () => [],
      ...options.detect
    },
    ...options.deps
  }
  return {
    service: new LocalService(deps),
    db,
    state,
    spawned,
    openedPaths,
    notified,
    progress,
    lookups,
    clones
  }
}

/** 캐시에 저장소 행을 넣는다. */
export function cacheRepo(db: DatabaseSync, id: number, owner: string, name: string): void {
  upsertRepositories(db, [repoRecord(id, { owner, name })])
}

/** 원격을 가진 git 작업 폴더를 만든다. remotes: [이름, 주소][] */
export async function makeWorkingCopy(
  dir: string,
  remotes: readonly (readonly [string, string])[]
): Promise<string> {
  await mkdir(dir, { recursive: true })
  await git(['init', '-q'], dir)
  for (const [name, url] of remotes) await git(['remote', 'add', name, url], dir)
  return dir
}
