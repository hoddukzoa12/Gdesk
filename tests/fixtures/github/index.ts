/**
 * 가짜 GitHub 서버 (화면 자동 테스트·단위 테스트 공용). 실제 GitHub 에는 접속하지 않는다(spec §13).
 *
 *   const server = await startFakeGitHub()
 *   // GDESK_TEST_API_BASE = server.apiBase, GDESK_TEST_WEB_BASE = server.webBase
 *   server.failNextWrites(1); server.goOffline(); server.setUnauthorized(true) ...
 *   await server.close()
 */
export { FIXTURE, avatarUrl, buildFixtures, fullName } from './data'
export type {
  FixtureActor,
  FixtureCommit,
  FixtureItem,
  FixtureNotification,
  FixtureRelease,
  FixtureRepo,
  FixtureState,
  RollupState
} from './data'
export { FakeGitHub, isWriteRequest, startFakeGitHub } from './server'
export type {
  Area,
  DeviceFlowOutcome,
  FaultOptions,
  RecordedRequest,
  RequestMatcher,
  StartFakeGitHubOptions
} from './server'
