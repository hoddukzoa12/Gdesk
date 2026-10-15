// 업데이트 상태 기계. 실제 업데이트 엔진(electron-updater)은 UpdateBackend 로 주입해
// electron 없이 단위 테스트한다. 실제 연결은 updater.ts 에 있다.
import type { UpdaterMode, UpdaterState, UpdaterStatus } from '@shared/domain/updater'
import { releasesPageUrl, type RepoRef, type UpdateModeDecision } from './mode'

/** 엔진이 알려 주는 사건. electron-updater 이벤트를 이 모양으로 옮긴다. */
export interface UpdateBackendEvents {
  onAvailable(version: string): void
  onNotAvailable(): void
  onProgress(percent: number): void
  onDownloaded(version: string): void
  onError(error: unknown): void
}

export interface UpdateBackend {
  /** 확인한다. 엔진이 꺼져 있으면 null. */
  check(): Promise<{ available: boolean; version: string } | null>
  /** 내려받은 업데이트를 적용하며 재시작한다. */
  install(): void
}

export interface UpdaterServiceDeps {
  decision: UpdateModeDecision
  currentVersion: string
  /** 저장소. 없으면 다운로드 페이지를 열 수 없다. */
  repo: RepoRef | null
  /** 첫 확인 때 한 번 만든다(그 전에는 엔진을 불러오지 않는다). */
  createBackend: (mode: Exclude<UpdaterMode, 'off'>, events: UpdateBackendEvents) => UpdateBackend
  openExternal: (url: string) => Promise<boolean>
  /** 상태가 바뀔 때마다 부른다(모든 창에 `updater:status`). */
  onChange: (status: UpdaterStatus) => void
  now?: () => number
}

export interface UpdaterService {
  getStatus(): UpdaterStatus
  /** 지금 확인한다. 이미 확인·다운로드 중이거나 준비됐으면 현재 상태를 그대로 돌려준다. */
  check(): Promise<UpdaterStatus>
  /** ready 일 때만 재시작해 적용한다. 받아들였으면 true. */
  install(): boolean
  openDownloadPage(): Promise<boolean>
  /** 백그라운드 확인 시작: 잠시 뒤 한 번, 이후 주기마다. 꺼진 방식이면 아무것도 하지 않는다. */
  start(options?: { initialDelayMs?: number; intervalMs?: number }): void
  stop(): void
}

/** 앱 시작 뒤 첫 확인까지 기다리는 시간. 시작 직후 네트워크·화면 부담을 피한다. */
export const DEFAULT_INITIAL_DELAY_MS = 10_000
/** 백그라운드 확인 주기. */
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000

const BUSY: ReadonlySet<UpdaterState> = new Set(['checking', 'downloading', 'ready'])
/** 이미 사용자에게 알렸거나 진행 중이라 백그라운드 확인을 건너뛰는 상태. */
const SKIP_BACKGROUND: ReadonlySet<UpdaterState> = new Set([...BUSY, 'available'])

const MAX_ERROR_LENGTH = 300

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const firstLine = text.split('\n')[0] ?? ''
  return firstLine.length > MAX_ERROR_LENGTH
    ? `${firstLine.slice(0, MAX_ERROR_LENGTH)}…`
    : firstLine
}

export function createUpdaterService(deps: UpdaterServiceDeps): UpdaterService {
  const now = deps.now ?? Date.now
  const { mode, initialState } = deps.decision

  let status: UpdaterStatus = {
    state: initialState,
    mode,
    currentVersion: deps.currentVersion,
    version: null,
    progress: null,
    checkedAt: null,
    error: null
  }
  let backend: UpdateBackend | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null

  function set(patch: Partial<UpdaterStatus>): void {
    status = { ...status, ...patch }
    deps.onChange(status)
  }

  function markAvailable(version: string): void {
    if (status.state === 'ready') return
    if (mode === 'auto') {
      // 이미 받는 중이면 진행률을 지우지 않는다
      if (status.state === 'downloading' && status.version === version) return
      set({ state: 'downloading', version, progress: 0, checkedAt: now(), error: null })
    } else {
      set({ state: 'available', version, progress: null, checkedAt: now(), error: null })
    }
  }

  const events: UpdateBackendEvents = {
    onAvailable: (version) => markAvailable(version),
    onNotAvailable: () => {
      if (status.state === 'ready' || status.state === 'downloading') return
      set({ state: 'up_to_date', version: null, progress: null, checkedAt: now(), error: null })
    },
    onProgress: (percent) => {
      if (mode !== 'auto' || status.state === 'ready') return
      const progress = Math.max(0, Math.min(100, Math.round(percent)))
      set({ state: 'downloading', progress })
    },
    onDownloaded: (version) => {
      if (mode !== 'auto') return
      set({ state: 'ready', version, progress: 100, error: null })
    },
    onError: (error) => {
      // 받아 둔 업데이트는 오류가 나도 재시작 때 적용된다
      if (status.state === 'ready') return
      set({ state: 'error', progress: null, error: errorMessage(error) })
    }
  }

  function getBackend(): UpdateBackend | null {
    if (mode === 'off') return null
    backend ??= deps.createBackend(mode, events)
    return backend
  }

  async function check(): Promise<UpdaterStatus> {
    const engine = getBackend()
    if (!engine || BUSY.has(status.state)) return status
    set({ state: 'checking', error: null })
    try {
      const result = await engine.check()
      // 이벤트가 먼저 상태를 바꿨으면 그대로 둔다
      if (status.state === 'checking') {
        if (result === null) set({ state: 'idle' })
        else if (result.available) markAvailable(result.version)
        else events.onNotAvailable()
      }
    } catch (error) {
      events.onError(error)
    }
    return status
  }

  function backgroundCheck(): void {
    if (SKIP_BACKGROUND.has(status.state)) return
    void check()
  }

  return {
    getStatus: () => status,
    check,
    install() {
      if (mode !== 'auto' || status.state !== 'ready' || !backend) return false
      backend.install()
      return true
    },
    async openDownloadPage() {
      if (!deps.repo) return false
      return deps.openExternal(releasesPageUrl(deps.repo))
    },
    start(options = {}) {
      if (mode === 'off' || initialTimer || intervalTimer) return
      const { initialDelayMs = DEFAULT_INITIAL_DELAY_MS, intervalMs = DEFAULT_INTERVAL_MS } =
        options
      initialTimer = setTimeout(() => {
        initialTimer = null
        backgroundCheck()
      }, initialDelayMs)
      intervalTimer = setInterval(backgroundCheck, intervalMs)
      // 타이머 때문에 앱 종료가 늦어지지 않게 한다
      initialTimer.unref?.()
      intervalTimer.unref?.()
    },
    stop() {
      if (initialTimer) clearTimeout(initialTimer)
      if (intervalTimer) clearInterval(intervalTimer)
      initialTimer = null
      intervalTimer = null
    }
  }
}
