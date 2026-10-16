// 빌드 때 넣을 OAuth App 공개 client ID 를 정한다. electron.vite.config.mts 와 단위 테스트가 함께 쓴다.
// client ID 는 비밀이 아니다(배포된 앱 안에서 누구나 볼 수 있다). client secret 은 어디에도 넣지 않는다.

/** Gdesk OAuth App 의 공개 client ID. `GDESK_GITHUB_CLIENT_ID` 가 없을 때 쓴다. */
export const DEFAULT_GITHUB_CLIENT_ID = 'Ov23liGhQ9tQPP7wqESg'

/**
 * - 환경 변수가 없으면 기본값.
 * - 있으면 그 값. 빈 문자열이면 브라우저 코드 로그인이 꺼진다(토큰 입력만).
 */
export function resolveClientId(env: Record<string, string | undefined>): string {
  return env.GDESK_GITHUB_CLIENT_ID ?? DEFAULT_GITHUB_CLIENT_ID
}
