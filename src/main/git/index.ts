// 내장 git 실행 층의 공개 API. 지금은 클론과 원격 읽기만 내보낸다.
// 테스트용 주입(CloneDeps: exec, sourceUrl)은 일부러 내보내지 않는다.
export { cloneRepository } from './clone'
export type { CloneOptions, CloneProgress, CloneProtocol, CloneResult } from './clone'
export { parseGitHubRemote, readGitHubRemotes } from './remote'
export type { GitHubRemote, GitHubRepoRef } from './remote'
