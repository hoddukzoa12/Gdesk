import type { SyncStatus } from '@shared/domain/sync'
import { getAuthService, onAuthChanged } from '../auth'
import { listOrgRestrictions, listSyncStates } from '../cache'
import { onAccountDataCleared } from '../db/cleanup'
import { getDb } from '../db/db'
import { getGitHubClient } from '../github/client'
import type { GitHubClient } from '../github/client'
import {
  refreshIssueLists,
  refreshMyRepositories,
  refreshNotifications,
  refreshPullRequestLists,
  refreshRepoOpenItems,
  refreshRepositoryDetails,
  refreshStarredRepositories
} from '../github/collectors'
import { notifyDataChanged } from '../ipc/data-events'
import { listPins, onPinsChanged } from '../pins/pins.service'
import { trackWindowPresence } from './electron'
import { SyncEngine } from './engine'
import type { SyncEngineOptions, SyncIntervals, SyncSession } from './engine'

export { DEFAULT_SYNC_INTERVALS, SyncEngine } from './engine'
export type { SyncEngineOptions, SyncIntervals, SyncRefreshers, SyncSession } from './engine'

/**
 * 동기화 엔진의 앱 연결. 메인 index.ts 가 startAuth 뒤, 첫 창을 만들기 전에 initSync() 를 한 번 부른다.
 * 창 열림·닫힘은 기본으로 Electron 앱 이벤트에서 알아서 따라간다(trackWindows).
 */

let engine: SyncEngine | null = null
let stopWindowTracking: (() => void) | null = null
const statusListeners = new Set<(status: SyncStatus) => void>()

/** 동기화 상태 변경 구독. initSync 전에 등록해도 된다(IPC 등록 순서와 무관) */
export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function getSyncEngine(): SyncEngine | null {
  return engine
}

/** 상세 추적 저장소 ID. 엔진 전이면 고정 목록 */
export function getDetailTrackedRepoIds(): number[] {
  return engine?.getTrackedRepoIds() ?? listPins(getDb()).map((p) => p.repoId)
}

function pinnedIds(): number[] {
  return listPins(getDb()).map((p) => p.repoId)
}

function sessionNow(): SyncSession {
  const s = getAuthService().getSession()
  return { state: s.state, inboxAvailable: s.inboxAvailable }
}

/** 저장된 범위별 동기화 시각 중 가장 최근 */
function readLastSyncedAt(): number | null {
  let latest: number | null = null
  for (const state of listSyncStates(getDb())) {
    if (state.lastSyncedAt !== null && (latest === null || state.lastSyncedAt > latest)) {
      latest = state.lastSyncedAt
    }
  }
  return latest
}

function describeError(error: unknown): string {
  // 요청 계층 오류 메시지는 토큰을 담지 않는다. 그래도 이름·메시지만 남긴다
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export interface InitSyncOptions {
  /** 기본 getGitHubClient() */
  client?: GitHubClient
  /** Electron 창 이벤트로 창 열림을 따라간다. 기본 true */
  trackWindows?: boolean
  intervals?: Partial<SyncIntervals>
  /** 테스트·조정용 덮어쓰기 */
  overrides?: Partial<SyncEngineOptions>
}

export function initSync(options: InitSyncOptions = {}): SyncEngine {
  disposeSync()
  const client = options.client ?? getGitHubClient()
  const next = new SyncEngine({
    refresh: {
      notifications: () => refreshNotifications({ client }),
      repositories: (pinnedRepoIds) => refreshMyRepositories({ client, pinnedRepoIds }),
      starred: () => refreshStarredRepositories({ client }),
      repoOpenItems: () => refreshRepoOpenItems({ client }),
      pullRequestLists: () => refreshPullRequestLists({ client }),
      issueLists: () => refreshIssueLists({ client }),
      repositoryDetail: (repoId) => refreshRepositoryDetails({ client, repoIds: [repoId] })
    },
    connection: client,
    session: {
      get: sessionNow,
      onChange: (listener) =>
        onAuthChanged((s) => listener({ state: s.state, inboxAvailable: s.inboxAvailable }))
    },
    pins: {
      list: pinnedIds,
      onChange: (listener) => {
        const offPins = onPinsChanged((pins) => listener(pins.map((p) => p.repoId)))
        // 다른 계정 로그인으로 고정이 지워진 경우
        const offCleared = onAccountDataCleared(() => listener(pinnedIds()))
        return () => {
          offPins()
          offCleared()
        }
      }
    },
    readLastSyncedAt,
    readOrgRestrictions: () => listOrgRestrictions(getDb()),
    notifyDataChanged,
    onStatus: (status) => {
      for (const listener of [...statusListeners]) listener(status)
    },
    onError: (unit, error) => console.warn(`[sync] ${unit} failed: ${describeError(error)}`),
    intervals: options.intervals,
    ...options.overrides
  })
  engine = next
  if (options.trackWindows ?? true) stopWindowTracking = trackWindowPresence(next)
  return next
}

/** 앱 종료·테스트용 */
export function disposeSync(): void {
  stopWindowTracking?.()
  stopWindowTracking = null
  engine?.dispose()
  engine = null
}
