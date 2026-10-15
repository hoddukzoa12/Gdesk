import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addLink, getLink } from '../db/links'
import { detectEditors } from './editors'
import type { DetectEnv } from './editors'
import { terminalCommand } from './launch'
import { createHarness } from './test-helpers'
import type { Harness } from './test-helpers'

let root: string
let dir: string
let h: Harness

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gdesk-open-test-')))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

let seq = 0
beforeEach(async () => {
  dir = join(root, `repo-${++seq}`)
  await mkdir(dir)
})

afterEach(() => {
  if (h?.db.isOpen) h.db.close()
})

const macApps = (apps: string[]): Partial<DetectEnv> => ({
  platform: 'darwin',
  homedir: '/Users/t',
  exists: (p) => apps.includes(p)
})

describe('detectEditors', () => {
  it('macOS: /Applications 와 ~/Applications 의 .app 을 찾는다', () => {
    const found = detectEditors({
      platform: 'darwin',
      homedir: '/Users/t',
      env: {},
      listDir: () => [],
      exists: (p) =>
        ['/Applications/Visual Studio Code.app', '/Users/t/Applications/WebStorm.app'].includes(p)
    })
    expect(found.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'vscode', name: 'Visual Studio Code' },
      { id: 'webstorm', name: 'WebStorm' }
    ])
    expect(found[1]).toMatchObject({
      command: 'open',
      args: ['-a', '/Users/t/Applications/WebStorm.app']
    })
  })

  it('Windows: 알려진 설치 경로, PATH 의 code·cursor, JetBrains 버전 폴더', () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      PATH: 'C:\\Tools\\VSCode\\bin;C:\\Windows'
    }
    const files = new Set([
      'C:\\Tools\\VSCode\\bin\\code.cmd',
      'C:\\Tools\\VSCode\\Code.exe',
      'C:\\Users\\t\\AppData\\Local\\Programs\\cursor\\Cursor.exe',
      'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1\\bin\\idea64.exe'
    ])
    const found = detectEditors({
      platform: 'win32',
      homedir: 'C:\\Users\\t',
      env,
      exists: (p) => files.has(p),
      listDir: (p) => (p === 'C:\\Program Files\\JetBrains' ? ['IntelliJ IDEA 2026.1'] : [])
    })
    expect(found.map((e) => [e.id, e.command, e.args])).toEqual([
      ['vscode', 'C:\\Tools\\VSCode\\Code.exe', []],
      ['cursor', 'C:\\Users\\t\\AppData\\Local\\Programs\\cursor\\Cursor.exe', []],
      ['intellij-idea', 'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1\\bin\\idea64.exe', []]
    ])
  })

  it('Linux: PATH 의 실행 파일', () => {
    const found = detectEditors({
      platform: 'linux',
      homedir: '/home/t',
      env: { PATH: '/usr/bin:/snap/bin' },
      exists: (p) => ['/usr/bin/zed', '/snap/bin/subl'].includes(p),
      listDir: () => []
    })
    expect(found.map((e) => [e.id, e.command])).toEqual([
      ['zed', '/usr/bin/zed'],
      ['sublime', '/snap/bin/subl']
    ])
  })
})

describe('terminalCommand', () => {
  const none = () => null
  it('macOS 는 open -a Terminal <경로>', () => {
    expect(terminalCommand('darwin', '/p', none)).toEqual({
      command: 'open',
      args: ['-a', 'Terminal', '/p']
    })
  })

  it('Windows 는 wt -d (작업 폴더로 전달), 없으면 cmd start', () => {
    expect(
      terminalCommand('win32', 'C:\\p', (c) => (c === 'wt.exe' ? 'C:\\wt.exe' : null))
    ).toEqual({ command: 'C:\\wt.exe', args: ['-d', '.'], cwd: 'C:\\p' })
    expect(terminalCommand('win32', 'C:\\p', none)).toEqual({
      command: 'cmd.exe',
      args: ['/c', 'start', '', 'cmd.exe'],
      cwd: 'C:\\p'
    })
  })

  it('Linux 는 x-terminal-emulator, gnome-terminal, konsole 순', () => {
    const only = (name: string) => (c: string) => (c === name ? `/usr/bin/${name}` : null)
    expect(terminalCommand('linux', '/p', only('x-terminal-emulator'))).toEqual({
      command: '/usr/bin/x-terminal-emulator',
      args: [],
      cwd: '/p'
    })
    expect(terminalCommand('linux', '/p', only('gnome-terminal'))).toEqual({
      command: '/usr/bin/gnome-terminal',
      args: ['--working-directory=/p'],
      cwd: '/p'
    })
    expect(terminalCommand('linux', '/p', only('konsole'))).toEqual({
      command: '/usr/bin/konsole',
      args: ['--workdir', '/p'],
      cwd: '/p'
    })
    expect(terminalCommand('linux', '/p', none)).toBeNull()
  })
})

describe('local:open', () => {
  it('편집기로 열면 lastUsedAt 을 갱신하고 경로를 인자 배열로 넘긴다', async () => {
    h = createHarness({ detect: macApps(['/Applications/Cursor.app', '/Applications/Zed.app']) })
    const { link } = addLink(h.db, 5, dir, { now: 1000 })
    expect(await h.service.open({ linkId: link.id, target: 'editor' })).toEqual({ ok: true })
    expect(h.spawned).toEqual([{ command: 'open', args: ['-a', '/Applications/Cursor.app', dir] }])
    expect(getLink(h.db, link.id)?.lastUsedAt).toBeGreaterThan(1000)
  })

  it('editorId, 설정의 기본 편집기 순으로 고른다', async () => {
    h = createHarness({ detect: macApps(['/Applications/Cursor.app', '/Applications/Zed.app']) })
    const { link } = addLink(h.db, 5, dir)
    h.state.settings.defaultEditor = 'zed'
    await h.service.open({ linkId: link.id, target: 'editor' })
    await h.service.open({ linkId: link.id, target: 'editor', editorId: 'cursor' })
    expect(h.spawned.map((c) => c.args[1])).toEqual([
      '/Applications/Zed.app',
      '/Applications/Cursor.app'
    ])
    expect(await h.service.open({ linkId: link.id, target: 'editor', editorId: 'vim' })).toEqual({
      ok: false,
      reason: 'unknown_editor'
    })
    h.state.settings.defaultEditor = 'uninstalled'
    await h.service.open({ linkId: link.id, target: 'editor' })
    expect(h.spawned.at(-1)?.args[1]).toBe('/Applications/Cursor.app')
  })

  it('편집기가 없으면 no_editor', async () => {
    h = createHarness({ detect: macApps([]) })
    const { link } = addLink(h.db, 5, dir)
    expect(await h.service.open({ linkId: link.id, target: 'editor' })).toEqual({
      ok: false,
      reason: 'no_editor'
    })
  })

  it('플랫폼별 터미널 명령을 실행한다', async () => {
    h = createHarness({
      detect: {
        platform: 'linux',
        env: { PATH: '/usr/bin' },
        exists: (p) => p === '/usr/bin/konsole'
      }
    })
    const { link } = addLink(h.db, 5, dir)
    expect(await h.service.open({ linkId: link.id, target: 'terminal' })).toEqual({ ok: true })
    expect(h.spawned).toEqual([{ command: '/usr/bin/konsole', args: ['--workdir', dir], cwd: dir }])
  })

  it('파일 관리자는 openPath, 실패하면 launch_failed', async () => {
    h = createHarness()
    const { link } = addLink(h.db, 5, dir)
    expect(await h.service.open({ linkId: link.id, target: 'fileManager' })).toEqual({ ok: true })
    expect(h.openedPaths).toEqual([dir])
    h.state.openPathError = 'Failed to open'
    expect(await h.service.open({ linkId: link.id, target: 'fileManager' })).toEqual({
      ok: false,
      reason: 'launch_failed',
      detail: 'Failed to open'
    })
  })

  it('실행이 실패하면 launch_failed', async () => {
    h = createHarness({
      detect: macApps(['/Applications/Zed.app']),
      deps: {
        launcher: {
          spawnDetached: async () => {
            throw new Error('spawn ENOENT')
          },
          openPath: async () => ''
        }
      }
    })
    const { link } = addLink(h.db, 5, dir)
    expect(await h.service.open({ linkId: link.id, target: 'editor' })).toEqual({
      ok: false,
      reason: 'launch_failed',
      detail: 'spawn ENOENT'
    })
  })

  it('폴더가 사라졌으면 missing 으로 표시하고 실행하지 않는다', async () => {
    h = createHarness({ detect: macApps(['/Applications/Zed.app']) })
    const { link } = addLink(h.db, 5, join(dir, 'gone'))
    expect(await h.service.open({ linkId: link.id, target: 'editor' })).toEqual({
      ok: false,
      reason: 'missing'
    })
    expect(getLink(h.db, link.id)?.status).toBe('missing')
    expect(h.spawned).toEqual([])
    expect(h.notified).toEqual([['repo:5', 'sidebar']])
    expect(await h.service.open({ linkId: 999, target: 'editor' })).toEqual({
      ok: false,
      reason: 'link_not_found'
    })
  })
})

describe('local:listEditors', () => {
  it('id 와 이름만 돌려준다', () => {
    h = createHarness({ detect: macApps(['/Applications/Sublime Text.app']) })
    expect(h.service.listEditors()).toEqual([{ id: 'sublime', name: 'Sublime Text' }])
  })
})
