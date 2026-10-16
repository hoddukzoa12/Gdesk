import type { IssueDetail, IssueRepoOption } from '../domain/issue-detail'
import type { ListPage } from '../domain/list'
import type { OrgRestrictionNotice } from '../domain/org'
import type { PullRequestRow } from '../domain/pr'
import type {
  HomeQueryResult,
  InboxQueryResult,
  IssuesQueryResult,
  IssuesTab,
  PullsTab,
  RepoDetailQueryResult,
  RepositoriesQueryResult,
  SidebarQueryResult
} from '../domain/queries'
import type { RepoSort, RepositorySummary } from '../domain/repo'

// 화면 조회. 캐시(로컬 DB)만 읽고 GitHub 에 요청하지 않는다. 채널이 `query:` 로 시작하므로
// data:changed 를 받으면 화면이 자동으로 다시 읽는다.
declare module './contract' {
  interface IpcInvokeChannels {
    'query:home': { req: void; res: HomeQueryResult }
    'query:inbox': {
      req: { unreadOnly?: boolean; repoId?: number; reason?: string }
      res: InboxQueryResult
    }
    'query:pulls': { req: { tab: PullsTab }; res: ListPage<PullRequestRow> }
    'query:reviews': { req: void; res: ListPage<PullRequestRow> }
    'query:issues': { req: { tab: IssuesTab }; res: IssuesQueryResult }
    /** 이슈 상세. 한 번도 받지 않았으면 null(받는 것은 sync:setViewedIssue) */
    'query:issueDetail': { req: { repoId: number; number: number }; res: IssueDetail | null }
    /** 새 이슈의 저장소 선택: 내 저장소(포크·보관 제외), 최근 푸시 순 */
    'query:issueRepoOptions': { req: void; res: IssueRepoOption[] }
    'query:starred': { req: { search?: string }; res: RepositorySummary[] }
    'query:repositories': {
      req: {
        includeForks?: boolean
        includeArchived?: boolean
        owner?: string
        sort?: RepoSort
        search?: string
      }
      res: RepositoriesQueryResult
    }
    'query:sidebar': { req: void; res: SidebarQueryResult }
    'query:repoDetail': { req: { repoId: number }; res: RepoDetailQueryResult | null }
    'query:orgRestrictions': { req: void; res: OrgRestrictionNotice[] }
  }
}

export {}
