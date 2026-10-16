import type {
  CommentRequest,
  CreateIssueRequest,
  CreateIssueResult,
  IssueActionResult,
  MarkdownPreviewResult,
  ReactRequest,
  RepoMetaResult,
  SetIssueStateRequest
} from '../domain/issue-actions'

// 이슈 쓰기 동작(spec §6.3). 막힘·가용성은 다른 쓰기 동작과 같은 actions:getAvailability·actions:availability 를 쓴다.
// 반응·닫기·다시 열기는 캐시의 이슈 상세를 먼저 바꾸고(data:changed) GitHub 에 요청하며, 실패하면 되돌린다.
// 같은 이슈에 대한 동작(반응·코멘트·닫기·다시 열기)은 순서대로 하나씩 처리한다. 쓰기를 모아 두었다가 나중에 보내지 않는다.
// 잘못된 요청 값(이슈 키·반응 종류·상태 등)은 거부(reject)한다.
declare module './contract' {
  interface IpcInvokeChannels {
    /** 내 반응 추가(add=true)·취소. subjectId 는 이슈나 그 코멘트의 노드 ID */
    'issueActions:react': { req: ReactRequest; res: IssueActionResult }
    'issueActions:comment': { req: CommentRequest; res: IssueActionResult }
    /** 닫기(reason: completed·not_planned, 기본 completed)·다시 열기 */
    'issueActions:setState': { req: SetIssueStateRequest; res: IssueActionResult }
    'issueActions:create': { req: CreateIssueRequest; res: CreateIssueResult }
    /** 새 이슈 양식의 라벨·담당자 선택지(GitHub 에서 바로 받음, 캐시 없음) */
    'issueActions:repoMeta': { req: { repoId: number }; res: RepoMetaResult }
    /** GitHub 마크다운 렌더링(gfm, 저장소 문맥). 돌려준 HTML 은 화면이 안전하게 그린다 */
    'issueActions:previewMarkdown': {
      req: { repoId: number; text: string }
      res: MarkdownPreviewResult
    }
  }
}

export {}
