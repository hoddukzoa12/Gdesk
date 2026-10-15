/**
 * 빌드·실행 설정 상수. 비밀 키(client secret)는 어디에도 두지 않는다.
 */

/** GitHub OAuth App 공개 client ID. 빌드 시 `GDESK_GITHUB_CLIENT_ID` 로 주입. 비어 있으면 브라우저 코드 로그인을 숨긴다. */
export const GITHUB_CLIENT_ID: string = __GDESK_GITHUB_CLIENT_ID__

/** Gdesk 저장소(`소유자/이름`). 오류 보고 이슈와 업데이트 확인에 쓴다. 빌드 시 `GDESK_REPO` 로 주입. */
export const GDESK_REPO: string = __GDESK_REPO__

export const DEFAULT_GITHUB_API_BASE = 'https://api.github.com'
export const DEFAULT_GITHUB_WEB_BASE = 'https://github.com'

/**
 * 화면 테스트 모드. 테스트 전용 빌드(`GDESK_TEST_BUILD=1`)이면서 실행 시 `GDESK_TEST_MODE=1` 일 때만 참.
 * 배포 빌드에서는 환경 변수로 켤 수 없다.
 */
export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return __GDESK_TEST_BUILD__ && env.GDESK_TEST_MODE === '1'
}

/** GitHub API 주소. 테스트 모드에서만 `GDESK_TEST_API_BASE` 로 바꿀 수 있다. */
export function githubApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.GDESK_TEST_API_BASE
  if (override && isTestMode(env)) return override.replace(/\/+$/, '')
  return DEFAULT_GITHUB_API_BASE
}
