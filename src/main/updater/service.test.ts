import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdaterStatus } from '@shared/domain/updater'
import type { UpdateModeDecision } from './mode'
import {
  createUpdaterService,
  type UpdateBackend,
  type UpdateBackendEvents,
  type UpdaterServiceDeps
} from './service'

interface Harness {
  service: ReturnType<typeof createUpdaterService>
  backend: UpdateBackend & { check: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn> }
  events: () => UpdateBackendEvents
  createBackend: ReturnType<typeof vi.fn>
  changes: UpdaterStatus[]
  openExternal: ReturnType<typeof vi.fn>
}

function setup(decision: UpdateModeDecision, overrides: Partial<UpdaterServiceDeps> = {}): Harness {
  let captured: UpdateBackendEvents | null = null
  const backend = {
    check: vi.fn().mockResolvedValue({ available: false, version: '1.0.0' }),
    install: vi.fn()
  }
  const createBackend = vi.fn((_mode: string, events: UpdateBackendEvents) => {
    captured = events
    return backend
  })
  const changes: UpdaterStatus[] = []
  const openExternal = vi.fn().mockResolvedValue(true)
  const service = createUpdaterService({
    decision,
    currentVersion: '1.0.0',
    repo: { owner: 'hoddukzoa', repo: 'gdesk' },
    createBackend,
    openExternal,
    onChange: (s) => changes.push(s),
    now: () => 1_000,
    ...overrides
  })
  return {
    service,
    backend,
    createBackend,
    changes,
    openExternal,
    events: () => {
      if (!captured) throw new Error('backend not created')
      return captured
    }
  }
}

const AUTO: UpdateModeDecision = { mode: 'auto', initialState: 'idle' }
const NOTIFY: UpdateModeDecision = { mode: 'notify', initialState: 'idle' }

afterEach(() => {
  vi.useRealTimers()
})

describe('꺼진 방식', () => {
  it.each([
    [{ mode: 'off', initialState: 'disabled' }],
    [{ mode: 'off', initialState: 'unavailable' }]
  ] as const)('%o: 확인해도 엔진을 만들지 않고 상태가 그대로다', async (decision) => {
    const h = setup(decision)
    const status = await h.service.check()
    expect(status.state).toBe(decision.initialState)
    expect(status.mode).toBe('off')
    expect(h.createBackend).not.toHaveBeenCalled()
    expect(h.service.install()).toBe(false)
  })

  it('저장소가 없으면 다운로드 페이지를 열지 않는다', async () => {
    const h = setup({ mode: 'off', initialState: 'unavailable' }, { repo: null })
    await expect(h.service.openDownloadPage()).resolves.toBe(false)
    expect(h.openExternal).not.toHaveBeenCalled()
  })

  it('start 는 타이머를 걸지 않는다', () => {
    vi.useFakeTimers()
    const h = setup({ mode: 'off', initialState: 'disabled' })
    h.service.start({ initialDelayMs: 10, intervalMs: 100 })
    vi.advanceTimersByTime(1_000)
    expect(h.createBackend).not.toHaveBeenCalled()
  })
})

describe('notify 방식(서명 안 된 맥, 리눅스 deb)', () => {
  it('새 버전이 있으면 available 로 알리고 내려받지 않는다', async () => {
    const h = setup(NOTIFY)
    h.backend.check.mockResolvedValue({ available: true, version: '1.2.0' })
    const status = await h.service.check()
    expect(h.createBackend).toHaveBeenCalledWith('notify', expect.anything())
    expect(status).toMatchObject({ state: 'available', version: '1.2.0', checkedAt: 1_000 })
    expect(h.changes.map((s) => s.state)).toEqual(['checking', 'available'])
    // notify 방식은 진행률·다운로드 완료를 무시하고 설치를 거부한다
    h.events().onProgress(50)
    h.events().onDownloaded('1.2.0')
    expect(h.service.getStatus().state).toBe('available')
    expect(h.service.install()).toBe(false)
    expect(h.backend.install).not.toHaveBeenCalled()
  })

  it('다운로드 페이지는 GitHub Releases 최신 릴리스', async () => {
    const h = setup(NOTIFY)
    await expect(h.service.openDownloadPage()).resolves.toBe(true)
    expect(h.openExternal).toHaveBeenCalledWith(
      'https://github.com/hoddukzoa/gdesk/releases/latest'
    )
  })

  it('최신이면 up_to_date', async () => {
    const h = setup(NOTIFY)
    const status = await h.service.check()
    expect(status).toMatchObject({ state: 'up_to_date', version: null, checkedAt: 1_000 })
  })
})

describe('auto 방식(윈도우, AppImage, 서명된 맥)', () => {
  it('available → downloading → ready → install', async () => {
    const h = setup(AUTO)
    h.backend.check.mockImplementation(async () => {
      h.events().onAvailable('2.0.0')
      return { available: true, version: '2.0.0' }
    })
    await h.service.check()
    expect(h.service.getStatus()).toMatchObject({ state: 'downloading', version: '2.0.0' })

    h.events().onProgress(42.4)
    expect(h.service.getStatus()).toMatchObject({ state: 'downloading', progress: 42 })

    // 받는 중에는 다시 확인하지 않는다
    await h.service.check()
    expect(h.backend.check).toHaveBeenCalledTimes(1)
    expect(h.service.install()).toBe(false)

    h.events().onDownloaded('2.0.0')
    expect(h.service.getStatus()).toMatchObject({ state: 'ready', version: '2.0.0', progress: 100 })

    // 준비된 뒤의 오류는 상태를 바꾸지 않는다
    h.events().onError(new Error('late'))
    expect(h.service.getStatus().state).toBe('ready')

    expect(h.service.install()).toBe(true)
    expect(h.backend.install).toHaveBeenCalledTimes(1)
  })

  it('확인 실패는 error 상태와 짧은 메시지', async () => {
    const h = setup(AUTO)
    h.backend.check.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED\nstack...'))
    const status = await h.service.check()
    expect(status).toMatchObject({ state: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' })
    // 오류 뒤에는 다시 확인할 수 있다
    h.backend.check.mockResolvedValue({ available: false, version: '1.0.0' })
    await expect(h.service.check()).resolves.toMatchObject({ state: 'up_to_date', error: null })
  })

  it('다운로드 중 오류 이벤트는 error', async () => {
    const h = setup(AUTO)
    h.backend.check.mockResolvedValue({ available: true, version: '2.0.0' })
    await h.service.check()
    h.events().onError('disk full')
    expect(h.service.getStatus()).toMatchObject({ state: 'error', error: 'disk full' })
  })

  it('엔진이 꺼져 있으면(null) idle 로 돌아간다', async () => {
    const h = setup(AUTO)
    h.backend.check.mockResolvedValue(null)
    await expect(h.service.check()).resolves.toMatchObject({ state: 'idle' })
  })

  it('엔진은 한 번만 만든다', async () => {
    const h = setup(AUTO)
    await h.service.check()
    await h.service.check()
    expect(h.createBackend).toHaveBeenCalledTimes(1)
    expect(h.createBackend).toHaveBeenCalledWith('auto', expect.anything())
  })
})

describe('백그라운드 확인', () => {
  it('처음 지연 뒤 확인하고 주기마다 다시 확인한다', async () => {
    vi.useFakeTimers()
    const h = setup(NOTIFY)
    h.service.start({ initialDelayMs: 10, intervalMs: 100 })
    expect(h.backend.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    expect(h.backend.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.backend.check).toHaveBeenCalledTimes(2)
    h.service.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.backend.check).toHaveBeenCalledTimes(2)
  })

  it('이미 알린 새 버전이 있으면 주기 확인을 건너뛴다', async () => {
    vi.useFakeTimers()
    const h = setup(NOTIFY)
    h.backend.check.mockResolvedValue({ available: true, version: '1.2.0' })
    h.service.start({ initialDelayMs: 10, intervalMs: 100 })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.backend.check).toHaveBeenCalledTimes(1)
    h.service.stop()
  })
})
