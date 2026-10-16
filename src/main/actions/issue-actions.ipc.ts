import '@shared/ipc/issue-actions'
import { getAuthService } from '../auth'
import { currentDataGuard } from '../db/cleanup'
import { getDb } from '../db/db'
import { getGitHubClient } from '../github/client'
import { notifyDataChanged } from '../ipc/data-events'
import { handle } from '../ipc/registry'
import { getSyncEngine } from '../sync'
import {
  createIssueActionsService,
  parseCommentRequest,
  parseCreateIssueRequest,
  parsePreviewRequest,
  parseReactRequest,
  parseRepoMetaRequest,
  parseSetStateRequest
} from './issue-actions.service'

// 이슈 쓰기 동작(spec §6.3). GitHub 클라이언트는 index.ts 에서 registerAllIpc() 전에 만들어진다.
// DB·세션·동기화 엔진은 호출 시점에 가져온다. 가용성(막힘)은 actions.ipc.ts 의 actions:availability 를 같이 쓴다.
// 화면에서 온 값은 다시 검사하고, 잘못된 요청은 던진다(거부).
export function registerIpc(): void {
  const service = createIssueActionsService({
    db: getDb,
    client: getGitHubClient(),
    getSession: () => getAuthService().getSession(),
    notify: notifyDataChanged,
    dataGuard: currentDataGuard,
    // 닫기·다시 열기 뒤 목록을 새로 받는다(엔진이 없으면 다음 자동 갱신에 맡긴다)
    refreshIssueLists: async () => {
      await getSyncEngine()?.refresh('issues')
    }
  })

  handle('issueActions:react', (req) => service.react(parseReactRequest(req)))
  handle('issueActions:comment', (req) => service.comment(parseCommentRequest(req)))
  handle('issueActions:setState', (req) => service.setState(parseSetStateRequest(req)))
  handle('issueActions:create', (req) => service.create(parseCreateIssueRequest(req)))
  handle('issueActions:repoMeta', (req) => service.repoMeta(parseRepoMetaRequest(req).repoId))
  handle('issueActions:previewMarkdown', (req) => {
    const { repoId, text } = parsePreviewRequest(req)
    return service.previewMarkdown(repoId, text)
  })
}
