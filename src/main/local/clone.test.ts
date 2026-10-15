import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { SessionState } from '@shared/domain/session'
import { listLinksByRepo } from '../db/links'
import type { GitHubRemote } from '../git'
import { cacheRepo, createHarness } from './test-helpers'
import type { Harness } from './test-helpers'

const BASE = '/gdesk-nonexistent-clone-base'
let h: Harness

beforeEach(() => {
  h = createHarness({ baseDir: BASE })
  cacheRepo(h.db, 7, 'me', 'app')
})

afterEach(() => {
  h.db.close()
})

const request = { cloneId: 'c1', repoId: 7, owner: 'me', name: 'app' }
const remote = (name: string, owner: string, repo: string): GitHubRemote => ({
  name,
  url: `https://github.com/${owner}/${repo}.git`,
  repo: { owner, name: repo }
})

describe('local:clone 조건', () => {
  const cases: [SessionState, ConnectionStatus, string][] = [
    ['signed_out', 'online', 'signed_out'],
    ['signing_in', 'online', 'signed_out'],
    ['expired', 'online', 'session_expired'],
    ['signed_in', 'session_expired', 'session_expired'],
    ['signed_in', 'offline', 'offline'],
    ['signed_in', 'rate_limited', 'rate_limited']
  ]
  it.each(cases)('세션 %s · 연결 %s 이면 %s 로 거부한다', async (session, status, code) => {
    h.state.session = session
    h.state.status = status
    const result = await h.service.clone(request)
    expect(result).toMatchObject({ kind: 'failed', code })
    expect(h.clones).toEqual([])
  })

  it('잘못된 요청과 상대 경로 대상은 거부한다', async () => {
    expect(await h.service.clone({ ...request, name: '..' })).toMatchObject({
      kind: 'failed',
      code: 'invalid_request'
    })
    expect(await h.service.clone({ ...request, cloneId: '' })).toMatchObject({
      kind: 'failed',
      code: 'invalid_request'
    })
    expect(await h.service.clone({ ...request, targetDir: 'rel/dir' })).toMatchObject({
      kind: 'failed',
      code: 'invalid_target'
    })
    expect(h.clones).toEqual([])
  })
})

describe('local:clone 실행', () => {
  it('기본 위치는 <클론 폴더>/<이름>, HTTPS 는 토큰을 넘기고, 끝나면 자동 연결하고 알린다', async () => {
    h.state.cloneResult = async (o) => {
      o.onProgress?.({ phase: 'Receiving objects', percent: 40 })
      return { kind: 'cloned', path: o.targetDir }
    }
    const result = await h.service.clone(request)
    expect(h.clones[0]).toMatchObject({
      owner: 'me',
      name: 'app',
      targetDir: join(BASE, 'app'),
      protocol: 'https',
      token: h.state.token
    })
    expect(h.progress).toEqual([{ cloneId: 'c1', phase: 'Receiving objects', percent: 40 }])
    expect(result).toMatchObject({ kind: 'cloned', path: join(BASE, 'app') })
    const links = listLinksByRepo(h.db, 7)
    expect(links.map((l) => l.path)).toEqual([join(BASE, 'app')])
    expect(result.kind === 'cloned' && result.link.id).toBe(links[0]?.id)
    expect(h.notified).toEqual([['repo:7', 'sidebar']])
  })

  it('SSH 는 토큰을 넘기지 않고, 대상 경로를 바꿀 수 있다', async () => {
    h.state.settings.cloneProtocol = 'ssh'
    h.state.cloneResult = async (o) => ({ kind: 'cloned', path: o.targetDir })
    await h.service.clone({ ...request, targetDir: '/elsewhere/custom' })
    expect(h.clones[0]).toMatchObject({ protocol: 'ssh', targetDir: '/elsewhere/custom' })
    expect(h.clones[0]?.token).toBeUndefined()
  })

  it('HTTPS 인데 토큰이 없으면 signed_out', async () => {
    h.state.token = null
    expect(await h.service.clone(request)).toMatchObject({ kind: 'failed', code: 'signed_out' })
  })

  it('이미 있는 폴더가 같은 저장소면 sameRepo(요청 이름·대소문자 무시)', async () => {
    h.state.cloneResult = async () => ({
      kind: 'exists',
      remotes: [remote('origin', 'ME', 'App'), remote('backup', 'x', 'y')]
    })
    const result = await h.service.clone(request)
    expect(result).toMatchObject({ kind: 'exists', path: join(BASE, 'app'), sameRepo: true })
    expect(result.kind === 'exists' && result.remotes).toHaveLength(2)
    expect(listLinksByRepo(h.db, 7)).toEqual([]) // 자동 연결하지 않고 제안만
  })

  it('upstream 이 현재 이름(이름 바뀐 저장소)과 맞아도 sameRepo', async () => {
    h.state.cloneResult = async () => ({
      kind: 'exists',
      remotes: [remote('origin', 'fork', 'whatever'), remote('upstream', 'me', 'app')]
    })
    const result = await h.service.clone({ ...request, owner: 'me', name: 'old-app' })
    expect(result).toMatchObject({ kind: 'exists', sameRepo: true })
  })

  it('옛 이름 원격은 조회로 같은 저장소인지 확인한다', async () => {
    h.state.api.set('me/older', 7)
    h.state.cloneResult = async () => ({
      kind: 'exists',
      remotes: [remote('origin', 'me', 'older')]
    })
    expect(await h.service.clone(request)).toMatchObject({ kind: 'exists', sameRepo: true })
  })

  it('다른 저장소이거나 git 폴더가 아니면 sameRepo=false', async () => {
    cacheRepo(h.db, 8, 'me', 'other')
    h.state.cloneResult = async () => ({
      kind: 'exists',
      remotes: [remote('origin', 'me', 'other')]
    })
    expect(await h.service.clone(request)).toMatchObject({ kind: 'exists', sameRepo: false })
    h.state.cloneResult = async () => ({ kind: 'exists', remotes: [] })
    expect(await h.service.clone(request)).toMatchObject({
      kind: 'exists',
      remotes: [],
      sameRepo: false
    })
  })

  it('이미 있는 폴더의 원격 주소에서 자격 증명을 지운다', async () => {
    const token = h.state.token ?? ''
    h.state.cloneResult = async () => ({
      kind: 'exists',
      remotes: [
        {
          name: 'origin',
          url: `https://x-access-token:${token}@github.com/me/app.git`,
          repo: { owner: 'me', name: 'app' }
        },
        { name: 'other', url: 'https://user:hunter2@example.com/x.git', repo: null },
        { name: 'ssh', url: 'git@github.com:me/app.git', repo: { owner: 'me', name: 'app' } }
      ]
    })
    const result = await h.service.clone(request)
    const text = JSON.stringify(result)
    expect(text).not.toContain(token)
    expect(text).not.toContain('hunter2')
    expect(result.kind === 'exists' && result.remotes.map((r) => r.url)).toEqual([
      'https://github.com/me/app.git',
      'https://example.com/x.git',
      'git@github.com:me/app.git'
    ])
  })

  it('실패는 코드로 분류하고 detail 에서 토큰을 가린다', async () => {
    const token = h.state.token ?? ''
    const fail = (message: string) => {
      h.state.cloneResult = async () => ({ kind: 'failed', message })
    }
    fail(`fatal: Authentication failed for 'https://x:${token}@github.com/me/app.git/'`)
    const auth = await h.service.clone(request)
    expect(auth).toMatchObject({ kind: 'failed', code: 'auth_failed' })
    expect(JSON.stringify(auth)).not.toContain(token)
    fail("fatal: repository 'https://github.com/me/app.git/' not found")
    expect(await h.service.clone(request)).toMatchObject({ code: 'not_found' })
    fail('git@github.com: Permission denied (publickey).')
    expect(await h.service.clone(request)).toMatchObject({ code: 'ssh_auth' })
    fail("fatal: unable to access 'https://github.com/me/app.git/': Could not resolve host")
    expect(await h.service.clone(request)).toMatchObject({ code: 'network' })
    fail('Cannot prepare target folder: EACCES: permission denied')
    expect(await h.service.clone(request)).toMatchObject({ code: 'target_error' })
    fail('something odd')
    expect(await h.service.clone(request)).toMatchObject({
      code: 'git_error',
      detail: 'something odd'
    })
  })

  it('취소하면 진행 중인 클론에 신호를 보낸다', async () => {
    let started!: () => void
    const running = new Promise<void>((resolve) => (started = resolve))
    h.state.cloneResult = (o) =>
      new Promise((resolve) => {
        started()
        o.signal?.addEventListener('abort', () => resolve({ kind: 'cancelled' }))
      })
    const pending = h.service.clone(request)
    await running
    expect(await h.service.clone(request)).toMatchObject({ code: 'already_running' })
    expect(h.service.cancelClone({ cloneId: 'c1' })).toEqual({ cancelled: true })
    expect(await pending).toEqual({ kind: 'cancelled' })
    expect(h.service.cancelClone({ cloneId: 'c1' })).toEqual({ cancelled: false })
    expect(listLinksByRepo(h.db, 7)).toEqual([])
  })
})
