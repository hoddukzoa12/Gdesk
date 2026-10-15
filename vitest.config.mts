import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 단위 테스트. 메인·공용 코드는 node 환경, 화면 컴포넌트 테스트는 파일 상단에
// `// @vitest-environment jsdom` 을 둔다. 화면 자동 테스트(tests/e2e)는 Playwright 가 맡는다.
export default defineConfig({
  define: {
    __GDESK_GITHUB_CLIENT_ID__: JSON.stringify(''),
    __GDESK_REPO__: JSON.stringify(''),
    __GDESK_TEST_BUILD__: JSON.stringify(false),
    __GDESK_MAC_SIGNED__: JSON.stringify(false)
  },
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer')
    }
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node'
  }
})
