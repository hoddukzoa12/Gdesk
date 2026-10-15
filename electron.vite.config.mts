import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 빌드 시 주입되는 값. 비밀 키는 절대 넣지 않는다(공개 client ID와 저장소 주소만).
const buildDefines = {
  __GDESK_GITHUB_CLIENT_ID__: JSON.stringify(process.env.GDESK_GITHUB_CLIENT_ID ?? ''),
  __GDESK_REPO__: JSON.stringify(process.env.GDESK_REPO ?? ''),
  // 화면 테스트 전용 빌드에서만 true. 배포 빌드에서는 테스트 모드를 켤 수 없다.
  __GDESK_TEST_BUILD__: JSON.stringify(process.env.GDESK_TEST_BUILD === '1'),
  // 맥 빌드가 서명·공증됐는지. CI 가 인증서 비밀값이 있을 때만 `GDESK_MAC_SIGNED=1` 로 빌드한다.
  // 서명 안 된 맥은 자동 설치 대신 "새 버전 있음" 알림만 띄운다.
  __GDESK_MAC_SIGNED__: JSON.stringify(process.env.GDESK_MAC_SIGNED === '1')
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
    plugins: [react(), tailwindcss()]
  }
})
