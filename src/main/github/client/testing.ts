import { GitHubClient, TEST_BASE_URL } from './client'
import type { GitHubClientInternalOptions, GitHubClientOptions } from './client'

/**
 * 단위 테스트 전용: 가짜 서버 주소로 클라이언트를 만든다.
 * index.ts 는 이 모듈을 내보내지 않는다. 테스트 실행(import.meta.env.MODE === 'test')이 아니면
 * GitHubClient 생성자가 거부한다. 배포 경로는 configureGitHubClient() → githubApiBase().
 */
export function createGitHubClientForTests(
  options: GitHubClientOptions & { baseUrl: string }
): GitHubClient {
  const { baseUrl, ...rest } = options
  const internal: GitHubClientInternalOptions = { ...rest, [TEST_BASE_URL]: baseUrl }
  return new GitHubClient(internal)
}
