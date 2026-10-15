import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReport } from '@shared/domain/crash'

const TOKEN = 'ghp_CrashSecretToken1234567890abcdefghij'

const handlers = new Map<string, (req: unknown) => unknown>()
const emitted: { event: string; payload: unknown }[] = []
const openedUrls: string[] = []
const clipboardWrites: string[] = []
const state = { testMode: false, repo: 'hoddukzoa/gdesk' }

vi.mock('electron', () => ({
  app: { getVersion: () => '0.9.0' },
  clipboard: { writeText: (text: string) => clipboardWrites.push(text) },
  shell: {
    openExternal: async (url: string) => {
      openedUrls.push(url)
    }
  }
}))

vi.mock('../ipc/registry', () => ({
  handle: (channel: string, handler: (req: unknown) => unknown) => handlers.set(channel, handler),
  emit: (event: string, payload: unknown) => emitted.push({ event, payload })
}))

vi.mock('../config', () => ({
  get GDESK_REPO() {
    return state.repo
  },
  isTestMode: () => state.testMode
}))

vi.mock('../auth', () => ({
  getAuthService: () => ({ getSession: () => ({ user: { login: 'octo-dev' } }) }),
  getToken: () => TOKEN
}))

vi.mock('../db/db', () => ({ isDbReady: () => true, getDb: () => ({}) }))

vi.mock('../cache', () => ({
  listMyRepositories: () => [
    { fullName: 'octo-dev/side-project', owner: 'octo-dev', name: 'side-project' }
  ],
  listStarredRepositories: () => [
    { fullName: 'megacorp/internal-tool', owner: 'megacorp', name: 'internal-tool' }
  ],
  listMyRepositoryOwners: () => [{ login: 'octo-dev' }, { login: 'my-org' }]
}))

const { registerIpc } = await import('./crash.ipc')
const { initCrashReporting, resetCrashReportingForTests } = await import('./index')

function call<T>(channel: string, req?: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(handler(req) as T)
}

function shownReports(): CrashReport[] {
  return emitted
    .filter((e) => e.event === 'crash:show')
    .map((e) => (e.payload as { report: CrashReport }).report)
}

beforeEach(() => {
  handlers.clear()
  emitted.length = 0
  openedUrls.length = 0
  clipboardWrites.length = 0
  state.testMode = false
  state.repo = 'hoddukzoa/gdesk'
  resetCrashReportingForTests()
  registerIpc()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('crash:reportRenderer', () => {
  it('화면 오류를 지운 보고서로 만들어 crash:show 로 보낸다', async () => {
    const res = await call<{ accepted: boolean }>('crash:reportRenderer', {
      message: `Error: octo-dev failed on megacorp/internal-tool with ${TOKEN}`,
      stack: 'at x (/Users/octo/Library/app.js:1:1)\nat https://github.com/megacorp/internal-tool'
    })
    expect(res.accepted).toBe(true)
    const [report] = shownReports()
    expect(report?.process).toBe('renderer')
    expect(report?.appVersion).toBe('0.9.0')
    const all = JSON.stringify(report)
    for (const secret of [TOKEN, 'octo-dev', 'megacorp', 'internal-tool', '/Users/octo']) {
      expect(all).not.toContain(secret)
    }
    expect(report?.message).toBe('Error: <user> failed on <repo> with <token>')
    expect(await call<CrashReport[]>('crash:pending')).toEqual([report])
  })

  it('형식이 틀린 요청은 받지 않는다', async () => {
    expect(await call('crash:reportRenderer', null)).toEqual({ accepted: false })
    expect(await call('crash:reportRenderer', { message: 42 })).toEqual({ accepted: false })
    expect(shownReports()).toHaveLength(0)
  })

  it('같은 오류가 반복되면 한 번만 보낸다', async () => {
    for (let i = 0; i < 5; i++) {
      await call('crash:reportRenderer', { message: 'same', stack: 'at a' })
    }
    expect(shownReports()).toHaveLength(1)
  })
})

describe('crash:openIssue · crash:copy', () => {
  async function report(): Promise<CrashReport> {
    await call('crash:reportRenderer', { message: 'Error: boom', stack: 'at a (b.js:1:1)' })
    const [r] = shownReports()
    if (!r) throw new Error('no report')
    return r
  }

  it('저장소가 있으면 내용을 채운 새 이슈 페이지를 브라우저로 연다', async () => {
    const r = await report()
    expect(r.sendMode).toBe('issue')
    const res = await call('crash:openIssue', { id: r.id })
    expect(res).toEqual({ opened: true, truncated: false })
    expect(openedUrls).toHaveLength(1)
    const url = new URL(openedUrls[0] ?? '')
    expect(url.origin + url.pathname).toBe('https://github.com/hoddukzoa/gdesk/issues/new')
    expect(url.searchParams.get('title')).toBe(r.title)
    expect(url.searchParams.get('body')).toBe(r.body)
  })

  it('저장소가 비어 있으면 보내기 방식이 copy 이고 클립보드에 복사한다', async () => {
    state.repo = ''
    const r = await report()
    expect(r.sendMode).toBe('copy')
    expect(await call('crash:openIssue', { id: r.id })).toEqual({ opened: false, truncated: false })
    expect(openedUrls).toHaveLength(0)
    expect(await call('crash:copy', { id: r.id })).toEqual({ copied: true })
    expect(clipboardWrites).toEqual([`${r.title}\n\n${r.body}`])
  })

  it('모르는 보고서 ID 는 아무것도 하지 않는다', async () => {
    expect(await call('crash:openIssue', { id: 'nope' })).toEqual({
      opened: false,
      truncated: false
    })
    expect(await call('crash:copy', { id: 'nope' })).toEqual({ copied: false })
    expect(openedUrls).toHaveLength(0)
    expect(clipboardWrites).toHaveLength(0)
  })

  it('닫으면 대기 목록에서 빠진다', async () => {
    const r = await report()
    await call('crash:dismiss', { id: r.id })
    expect(await call('crash:pending')).toEqual([])
  })
})

describe('crash:testTrigger', () => {
  it('테스트 모드가 아니면 거부한다', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate', 'setTimeout'] })
    expect(await call('crash:testTrigger', { where: 'main' })).toEqual({ accepted: false })
    expect(await call('crash:testTrigger', { where: 'renderer' })).toEqual({ accepted: false })
    expect(vi.getTimerCount()).toBe(0)
    expect(emitted).toHaveLength(0)
  })

  it('테스트 모드에서 main 은 처리되지 않은 오류를 일부러 던진다', async () => {
    state.testMode = true
    vi.useFakeTimers({ toFake: ['setImmediate', 'setTimeout'] })
    expect(await call('crash:testTrigger', { where: 'main' })).toEqual({ accepted: true })
    expect(() => vi.runAllTimers()).toThrow(/Gdesk crash test/)
  })

  it('테스트 모드에서 renderer 는 화면에 오류를 내라고 알린다', async () => {
    state.testMode = true
    expect(await call('crash:testTrigger', { where: 'renderer' })).toEqual({ accepted: true })
    expect(emitted).toEqual([
      { event: 'crash:testThrow', payload: { message: expect.stringMatching(/Gdesk crash test/) } }
    ])
  })

  it('알 수 없는 위치는 거부한다', async () => {
    state.testMode = true
    expect(await call('crash:testTrigger', { where: 'gpu' })).toEqual({ accepted: false })
  })
})

describe('initCrashReporting', () => {
  it('메인 프로세스의 처리되지 않은 오류·거부를 잡아 보여 준다(두 번 불러도 한 번만 설치)', () => {
    const target = new EventEmitter()
    initCrashReporting(target)
    initCrashReporting(target)
    expect(target.listenerCount('uncaughtException')).toBe(1)
    expect(target.listenerCount('unhandledRejection')).toBe(1)
    target.emit('uncaughtException', new Error('main boom at /home/octo/x.js'))
    target.emit('unhandledRejection', 'rejected value', Promise.resolve())
    expect(shownReports().map((r) => [r.process, r.message])).toEqual([
      ['main', 'Error: main boom at ~/x.js'],
      ['main', 'rejected value']
    ])
    resetCrashReportingForTests()
    expect(target.listenerCount('uncaughtException')).toBe(0)
    expect(target.listenerCount('unhandledRejection')).toBe(0)
  })
})
