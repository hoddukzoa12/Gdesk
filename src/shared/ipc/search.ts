import type { GitHubSearchResult, LocalSearchResult } from '../domain/search'

// 빠른 검색창(spec §4.12).
// - search:local  저장된 정보(캐시)에서 저장소·PR·이슈를 찾는다. 오프라인에서도 동작한다.
// - search:github GitHub 전체 저장소 검색. online 이 아니면 요청하지 않고 거절한다.
// 둘 다 검색어가 2자 미만이면 빈 결과, 구역마다 최대 10개.
declare module './contract' {
  interface IpcInvokeChannels {
    'search:local': { req: { text: string }; res: LocalSearchResult }
    'search:github': { req: { text: string }; res: GitHubSearchResult }
  }
}

export {}
