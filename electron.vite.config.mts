import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { resolveClientId } from './build/client-id'

// 빌드 시 주입되는 값. 비밀 키는 절대 넣지 않는다(공개 client ID와 저장소 주소만).
const buildDefines = {
  // 환경 변수가 없으면 기본 공개 client ID, 빈 문자열이면 브라우저 로그인 끔(build/client-id.ts).
  __GDESK_GITHUB_CLIENT_ID__: JSON.stringify(resolveClientId(process.env)),
  __GDESK_REPO__: JSON.stringify(process.env.GDESK_REPO ?? ''),
  // 화면 테스트 전용 빌드에서만 true. 배포 빌드에서는 테스트 모드를 켤 수 없다.
  __GDESK_TEST_BUILD__: JSON.stringify(process.env.GDESK_TEST_BUILD === '1'),
  // 맥 빌드가 서명·공증됐는지. CI 가 인증서 비밀값이 있을 때만 `GDESK_MAC_SIGNED=1` 로 빌드한다.
  // 서명 안 된 맥은 자동 설치 대신 "새 버전 있음" 알림만 띄운다.
  __GDESK_MAC_SIGNED__: JSON.stringify(process.env.GDESK_MAC_SIGNED === '1')
}

/**
 * 개발 서버(`pnpm dev`)에서만 CSP 의 connect-src 에 HMR 웹소켓(ws://localhost:*)을 더한다.
 * 빌드 결과(배포·화면 테스트)의 index.html 은 src/renderer/index.html 의 CSP 그대로다(GitHub 외 통신 없음).
 */
function devServerCsp(): Plugin {
  const shipped = "connect-src 'self'"
  return {
    name: 'gdesk-dev-server-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!html.includes(shipped)) throw new Error(`index.html CSP must contain "${shipped}"`)
      return html.replace(shipped, `${shipped} ws://localhost:*`)
    }
  }
}

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared')
}

export default defineConfig({
  main: {
    define: buildDefines,
    resolve: { alias }
  },
  preload: {
    define: buildDefines,
    resolve: { alias }
  },
  renderer: {
    define: buildDefines,
    resolve: {
      alias: {
        ...alias,
        '@renderer': resolve(import.meta.dirname, 'src/renderer')
      }
    },
    plugins: [react(), tailwindcss(), devServerCsp()]
  }
})
