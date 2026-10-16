import '@shared/ipc/queries'
import { getAuthService } from '../auth'
import { getDb } from '../db/db'
import { handle } from '../ipc/registry'
import { getDetailTrackedRepoIds } from '../sync'
import {
  queryHome,
  queryInbox,
  queryIssueDetail,
  queryIssueRepoOptions,
  queryIssues,
  queryOrgRestrictions,
  queryPulls,
  queryRepoDetail,
  queryRepositories,
  queryReviews,
  querySidebar,
  queryStarred
} from './queries'
import type { QueryContext } from './queries'

const context: QueryContext = {
  trackedRepoIds: getDetailTrackedRepoIds,
  inboxAvailable: () => {
    try {
      return getAuthService().getSession().inboxAvailable
    } catch {
      return false
    }
  },
  viewerLogin: () => {
    try {
      return getAuthService().getSession().user?.login ?? null
    } catch {
      return null
    }
  }
}

// 캐시만 읽는다. DB 는 호출 시점에 가져온다(등록이 DB 초기화보다 먼저일 수 있다).
export function registerIpc(): void {
  handle('query:home', () => queryHome(getDb(), context))
  handle('query:inbox', (req) => queryInbox(getDb(), req, context))
  handle('query:pulls', (req) => queryPulls(getDb(), req))
  handle('query:reviews', () => queryReviews(getDb()))
  handle('query:issues', (req) => queryIssues(getDb(), req))
  handle('query:issueDetail', (req) => queryIssueDetail(getDb(), req))
  handle('query:issueRepoOptions', () => queryIssueRepoOptions(getDb()))
  handle('query:starred', (req) => queryStarred(getDb(), req))
  handle('query:repositories', (req) => queryRepositories(getDb(), req))
  handle('query:sidebar', () => querySidebar(getDb()))
  handle('query:repoDetail', (req) => queryRepoDetail(getDb(), req, context))
  handle('query:orgRestrictions', () => queryOrgRestrictions(getDb()))
}
