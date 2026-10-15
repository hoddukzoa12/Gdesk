import { defineConfig } from '@playwright/test'

// 화면 자동 테스트: 테스트 전용 빌드(out/)를 Electron 으로 띄워 가짜 GitHub 서버에 연결한다.
// 실제 GitHub 에는 접속하지 않는다(spec 13). 하네스는 tests/e2e/ 에 있다.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
