import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, test as base } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { FIXTURE, startFakeGitHub } from '../../fixtures/github'
import type { FakeGitHub, StartFakeGitHubOptions } from '../../fixtures/github'
import { stubOpenExternal } from './helpers'

/**
 * 화면 자동 테스트 하네스 (spec §13).
 * 테스트마다 가짜 GitHub 서버를 띄우고, 새 임시 사용자 데이터 폴더로 테스트 빌드(out/)를 테스트 모드로 실행한다.
 *
 *   import { test, expect } from './support/fixtures'
 *   test('...', async ({ app, page, server }) => { ... })      // 토큰으로 로그인된 상태
 *   test.describe(() => { test.use({ token: null }); ... })    // 로그인 화면(토큰 없음)
 *   const second = await launchGdesk({ userDataDir })          // 같은 폴더로 다시 띄우기 등
 */

/** 저장소 루트(package.json 의 main → out/main/index.js) */
export const REPO_ROOT = resolve(__dirname, '../../..')

export interface LaunchOptions {
  /** GDESK_TEST_TOKEN. null 이면 넣지 않는다(로그인 화면). 기본: token 옵션 */
  token?: string | null
  /** 사용자 데이터 폴더. 기본: 새 임시 폴더(테스트가 끝나면 지운다) */
  userDataDir?: string
  /** 추가 환경 변수 */
  env?: Record<string, string>
  /** shell.openExternal 을 가짜로 바꾼다. 기본 true */
  stubExternal?: boolean
}

export interface LaunchedGdesk {
  app: ElectronApplication
  /** 첫 창 */
  page: Page
  server: FakeGitHub
  userDataDir: string
}

export interface GdeskOptions {
  /** 기본 실행의 GDESK_TEST_TOKEN. null 이면 토큰 없이(로그인 화면) */
  token: string | null
  /** 가짜 서버 시작 옵션(데이터 고치기 등) */
  serverOptions: StartFakeGitHubOptions
}

export interface GdeskFixtures {
  /** 이 테스트의 가짜 GitHub 서버 */
  server: FakeGitHub
  /** 앱을 (또) 띄운다. 띄운 앱과 만든 임시 폴더는 테스트가 끝나면 정리된다 */
  launchGdesk: (options?: LaunchOptions) => Promise<LaunchedGdesk>
  /** token 옵션으로 띄운 앱 */
  gdesk: LaunchedGdesk
  app: ElectronApplication
  page: Page
}

function testEnv(server: FakeGitHub, userDataDir: string, token: string | null) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // 개발 서버 주소나 바깥에서 넣은 테스트 값이 섞이지 않게 한다
  delete env.ELECTRON_RENDERER_URL
  delete env.GDESK_TEST_TOKEN
  env.GDESK_TEST_MODE = '1'
  env.GDESK_TEST_API_BASE = server.apiBase
  env.GDESK_TEST_WEB_BASE = server.webBase
  env.GDESK_TEST_USER_DATA = userDataDir
  if (token !== null) env.GDESK_TEST_TOKEN = token
  return env
}

export const test = base.extend<GdeskOptions & GdeskFixtures>({
  token: [FIXTURE.token, { option: true }],
  serverOptions: [{}, { option: true }],

  server: async ({ serverOptions }, use) => {
    const server = await startFakeGitHub(serverOptions)
    await use(server)
    await server.close()
  },

  launchGdesk: async ({ server, token: defaultToken }, use, testInfo) => {
    const apps: ElectronApplication[] = []
    const tempDirs: string[] = []
    const logs: string[] = []

    const launch = async (options: LaunchOptions = {}): Promise<LaunchedGdesk> => {
      let userDataDir = options.userDataDir
      if (!userDataDir) {
        userDataDir = await mkdtemp(join(tmpdir(), 'gdesk-e2e-'))
        tempDirs.push(userDataDir)
      }
      const token = options.token === undefined ? defaultToken : options.token
      const app = await _electron.launch({
        args: [REPO_ROOT],
        cwd: REPO_ROOT,
        env: { ...testEnv(server, userDataDir, token), ...options.env },
        timeout: 30_000
      })
      apps.push(app)
      const child = app.process()
      child.stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
      child.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
      if (options.stubExternal ?? true) await stubOpenExternal(app)
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      return { app, page, server, userDataDir }
    }

    await use(launch)

    for (const app of apps.reverse()) {
      await app.close().catch(() => undefined)
    }
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('electron-main.log', { body: logs.join(''), contentType: 'text/plain' })
      await testInfo.attach('fake-github-requests.json', {
        body: JSON.stringify(server.requests, null, 2),
        contentType: 'application/json'
      })
    }
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  },

  gdesk: async ({ launchGdesk }, use) => {
    await use(await launchGdesk())
  },

  app: async ({ gdesk }, use) => {
    await use(gdesk.app)
  },

  page: async ({ gdesk }, use) => {
    await use(gdesk.page)
  }
})

export { expect } from '@playwright/test'
