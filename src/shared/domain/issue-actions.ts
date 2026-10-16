import type { ActionBlockReason } from './actions'
import { REACTION_CONTENTS } from './issue-detail'
import type { IssueRef, ReactionContent } from './issue-detail'

/**
 * 이슈 쓰기 동작(spec §6.3): 반응, 코멘트, 닫기·다시 열기, 새 이슈, 라벨·담당자 선택지, 마크다운 미리보기.
 * 막힘 조건과 우선순위는 다른 쓰기 동작과 같다(`ActionBlockReason`, `actions:getAvailability`·
 * `actions:availability` 로 버튼을 켜고 끈다). 막히면 요청도 캐시 변경도 하지 않는다. 대기열은 없다.
 */

/**
 * 쓰기 동작 막힘 밖에서 이슈 동작을 거절하는 이유. 요청도 캐시 변경도 하지 않았다.
 * - not_allowed: GitHub 가 허락하지 않는다(viewerCanReact·viewerCanComment·viewerCanClose·viewerCanReopen 이 false)
 * - not_cached: 이슈 상세를 받은 적이 없어 노드 ID·권한을 모른다(패널을 열어 상세를 받은 뒤 다시)
 * - empty_body: 코멘트 본문이 비었거나 공백뿐
 * - empty_title: 새 이슈 제목이 비었거나 공백뿐
 * - repo_not_mine: 새 이슈 저장소가 내 저장소 집합(소유 + 쓰기 권한)에 없다(캐시에 없는 저장소 포함)
 * - repo_fork / repo_archived / repo_issues_disabled: 포크, 보관됨, 이슈를 끈 저장소
 */
export type IssueActionRejectReason =
  | 'not_allowed'
  | 'not_cached'
  | 'empty_body'
  | 'empty_title'
  | 'repo_not_mine'
  | 'repo_fork'
  | 'repo_archived'
  | 'repo_issues_disabled'

export const ISSUE_ACTION_REJECT_REASONS: readonly IssueActionRejectReason[] = [
  'not_allowed',
  'not_cached',
  'empty_body',
  'empty_title',
  'repo_not_mine',
  'repo_fork',
  'repo_archived',
  'repo_issues_disabled'
]

/** 새 이슈 저장소 조건으로 거절하는 이유 */
export type IssueRepoRejectReason = Extract<IssueActionRejectReason, `repo_${string}`>

/**
 * 실패 결과(공통).
 * - 막힘(ActionBlockReason) · 거절(IssueActionRejectReason): 요청도 캐시 변경도 하지 않았다.
 * - failed: GitHub 요청이 실패했다. 낙관적으로 바꾼 캐시는 원래대로 되돌렸다. message 는 화면에 보여도 되는
 *   문구(토큰 없음)다. 화면은 입력한 글(코멘트·새 이슈 양식)을 그대로 둔다.
 */
export type IssueActionFailure =
  | { ok: false; reason: ActionBlockReason | IssueActionRejectReason }
  | { ok: false; reason: 'failed'; message: string }

/** 반응·코멘트·닫기·다시 열기의 결과 */
export type IssueActionResult = { ok: true } | IssueActionFailure

/** 만든 이슈 */
export interface CreatedIssue {
  repoId: number
  number: number
  /** GraphQL 노드 ID */
  nodeId: string
}

export type CreateIssueResult = { ok: true; issue: CreatedIssue } | IssueActionFailure

/** 이슈 닫기 이유. 다시 열기는 이유가 없다 */
export type IssueCloseReason = 'completed' | 'not_planned'
export const ISSUE_CLOSE_REASONS: readonly IssueCloseReason[] = ['completed', 'not_planned']

/** 반응 추가(add=true)·취소(add=false). subjectId 는 이슈 또는 그 이슈 코멘트의 노드 ID */
export interface ReactRequest {
  subjectId: string
  issueRef: IssueRef
  content: ReactionContent
  add: boolean
}

export interface CommentRequest {
  issueRef: IssueRef
  /** 마크다운 */
  body: string
}

/** state 'closed' 면 reason(기본 completed), 'open' 이면 다시 열기(reason 무시) */
export interface SetIssueStateRequest {
  issueRef: IssueRef
  state: 'open' | 'closed'
  reason?: IssueCloseReason
}

export interface CreateIssueRequest {
  repoId: number
  title: string
  /** 마크다운. 비어도 된다 */
  body?: string
  /** 라벨 이름 */
  labels?: string[]
  /** 담당자 로그인 */
  assignees?: string[]
}

/** 새 이슈 양식의 라벨 선택지 */
export interface RepoLabelOption {
  name: string
  /** 6자리 16진수(# 없음) */
  color: string | null
  description: string | null
}

/** 새 이슈 양식의 담당자 선택지 */
export interface RepoAssigneeOption {
  login: string
  avatarUrl: string | null
}

export type RepoMetaResult =
  { ok: true; labels: RepoLabelOption[]; assignees: RepoAssigneeOption[] } | IssueActionFailure

/** GitHub 가 만든 HTML 그대로(화면이 안전하게 그린다) */
export type MarkdownPreviewResult = { ok: true; html: string } | IssueActionFailure

/** 새 이슈에 붙일 수 있는 최대 담당자 수(GitHub 제한) */
export const MAX_ISSUE_ASSIGNEES = 10
/** 새 이슈에 붙일 라벨 수 상한(요청 검사용) */
export const MAX_ISSUE_LABELS = 100

export function isReactionContent(value: unknown): value is ReactionContent {
  return typeof value === 'string' && (REACTION_CONTENTS as readonly string[]).includes(value)
}

export function isIssueCloseReason(value: unknown): value is IssueCloseReason {
  return typeof value === 'string' && (ISSUE_CLOSE_REASONS as readonly string[]).includes(value)
}

/** 이슈 상세 캐시 변경 알림 키. 동기화 엔진의 이슈 상세 키와 같은 모양이다 */
export function issueDetailKey(ref: IssueRef): string {
  return `issue:${ref.repoId}#${ref.number}`
}
