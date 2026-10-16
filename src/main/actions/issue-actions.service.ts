import type { DatabaseSync } from 'node:sqlite'
import type { ActionBlockReason } from '@shared/domain/actions'
import {
  MAX_ISSUE_ASSIGNEES,
  MAX_ISSUE_LABELS,
  issueDetailKey,
  isIssueCloseReason,
  isReactionContent
} from '@shared/domain/issue-actions'
import type {
  CommentRequest,
  CreateIssueRequest,
  CreateIssueResult,
  IssueActionFailure,
  IssueActionRejectReason,
  IssueActionResult,
  IssueRepoRejectReason,
  MarkdownPreviewResult,
  ReactRequest,
  RepoAssigneeOption,
  RepoLabelOption,
  RepoMetaResult,
  SetIssueStateRequest
} from '@shared/domain/issue-actions'
import { assertIssueRef } from '@shared/domain/issue-detail'
import type {
  IssueDetail,
  IssueRef,
  ReactionContent,
  ReactionGroup
} from '@shared/domain/issue-detail'
import type { SessionState } from '@shared/domain/session'
import {
  forgetCreatedIssue,
  getIssueDetail,
  getIssueTargetRepo,
  lookupRepoFullName,
  patchIssueDetail,
  recordCreatedIssue,
  restoreIssueDetail
} from '../cache'
import type { IssueDetailSnapshot } from '../cache'
import type { IssueDetailRecord, IssueRecord } from '../cache/types'
import type { GitHubClient } from '../github/client/client'
import { mapIssueComment } from '../github/collectors/map'
import {
  ADD_COMMENT_MUTATION,
  ADD_REACTION_MUTATION,
  CLOSE_ISSUE_MUTATION,
  OPERATIONS,
  REMOVE_REACTION_MUTATION,
  REOPEN_ISSUE_MUTATION,
  REPO_META_LIMITS
} from '../github/collectors/queries'
import type { RawIssueComment } from '../github/collectors/raw'
import { assertRepoId } from '../pins/pins.service'
import {
  createKeyedSerializer,
  readSessionState,
  resolveActionBlockReason,
  safeMessage
} from './actions.service'

/**
 * 이슈 쓰기 동작(spec §6.3): 반응, 코멘트, 닫기·다시 열기, 새 이슈, 새 이슈 양식의 라벨·담당자 선택지, 마크다운 미리보기.
 *
 * - 막힘: 다른 쓰기 동작과 같다(resolveActionBlockReason). 막히면 요청도 캐시 변경도 하지 않는다. 대기열은 없다.
 * - 권한: 캐시된 이슈 상세의 viewerCan* 으로 판단한다. 상세가 없으면(노드 ID·권한을 모르면) not_cached.
 * - 반응·닫기·다시 열기는 낙관적: 상세 캐시를 먼저 바꾸고 notify → GitHub 요청. 실패하면 바꾸기 전 원문으로
 *   정확히 되돌리고 다시 notify 한 뒤 failed.
 * - 코멘트·새 이슈는 성공한 뒤에 응답으로 캐시를 바꾼다. 이때는 요청 시작 때 잡은 계정 데이터 세대를 쓰기 직전에
 *   확인한다(그사이 로그아웃·계정 전환이면 쓰지 않는다).
 * - 동시성: 같은 이슈에 대한 반응·코멘트·닫기·다시 열기는 하나씩 차례로 처리한다(반응 대상이 이슈든 코멘트든
 *   같은 상세 한 덩어리를 바꾸므로, 되돌리기가 다른 동작의 변경을 덮지 않게 이슈 단위로 묶는다).
 *   뒤 동작은 앞 동작이 끝난(실패면 되돌린) 뒤 그때의 상태로 막힘을 다시 판단한다. 새 이슈는 저장소 단위다.
 */

export type IssueActionsClient = Pick<
  GitHubClient,
  'graphql' | 'post' | 'getAllPages' | 'getStatus'
>

export interface IssueActionsServiceOptions {
  /** 호출 시점에 DB 를 가져온다(앱에서는 getDb) */
  db: () => DatabaseSync
  client: IssueActionsClient
  /** 현재 세션. 읽을 수 없으면(인증 초기화 전) 던져도 된다 → signed_out */
  getSession: () => { state: SessionState }
  /** 캐시가 바뀐 범위를 화면에 알린다(앱에서는 notifyDataChanged) */
  notify: (keys: string[]) => void
  /** 닫기·다시 열기 성공 뒤 이슈 목록을 새로 받게 한다(앱에서는 동기화 엔진의 refresh('issues')). 기다리지 않는다 */
  refreshIssueLists?: () => Promise<unknown>
  /** 계정 데이터 세대 잡기(앱에서는 currentDataGuard). 기본은 언제나 현재 */
  dataGuard?: () => () => boolean
  /** 라벨·담당자 목록 최대 페이지 수(페이지당 100). 기본 REPO_META_LIMITS */
  repoMetaMaxPages?: number
  /** 만든 이슈의 기록 시각. 기본 Date.now */
  now?: () => number
}

export interface IssueActionsService {
  react(request: ReactRequest): Promise<IssueActionResult>
  comment(request: CommentRequest): Promise<IssueActionResult>
  setState(request: SetIssueStateRequest): Promise<IssueActionResult>
  create(request: CreateIssueRequest): Promise<CreateIssueResult>
  repoMeta(repoId: number): Promise<RepoMetaResult>
  previewMarkdown(repoId: number, text: string): Promise<MarkdownPreviewResult>
}

/** 이슈 하나가 바뀌었을 때 알리는 키 */
export function issueActionKeys(ref: IssueRef): string[] {
  return ['issues', 'home', issueDetailKey(ref)]
}

export const CREATE_ISSUE_KEYS: readonly string[] = ['issues', 'home']

// ───────────────────────── 요청 값 검사(잘못된 요청은 던진다) ─────────────────────────

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`Invalid ${what} request`)
  return value as Record<string, unknown>
}

function issueRefOf(value: unknown): IssueRef {
  assertIssueRef(value)
  return { repoId: value.repoId, number: value.number }
}

export function parseReactRequest(value: unknown): ReactRequest {
  const v = record(value, 'reaction')
  if (typeof v.subjectId !== 'string' || v.subjectId.trim() === '') {
    throw new Error('Invalid reaction subject')
  }
  if (!isReactionContent(v.content)) throw new Error(`Invalid reaction: ${String(v.content)}`)
  if (typeof v.add !== 'boolean') throw new Error('Invalid reaction flag')
  return {
    subjectId: v.subjectId,
    issueRef: issueRefOf(v.issueRef),
    content: v.content,
    add: v.add
  }
}

export function parseCommentRequest(value: unknown): CommentRequest {
  const v = record(value, 'comment')
  if (typeof v.body !== 'string') throw new Error('Invalid comment body')
  return { issueRef: issueRefOf(v.issueRef), body: v.body }
}

export function parseSetStateRequest(value: unknown): SetIssueStateRequest {
  const v = record(value, 'issue state')
  const issueRef = issueRefOf(v.issueRef)
  if (v.state === 'open') return { issueRef, state: 'open' }
  if (v.state !== 'closed') throw new Error(`Invalid issue state: ${String(v.state)}`)
  if (v.reason === undefined || v.reason === null) return { issueRef, state: 'closed' }
  if (!isIssueCloseReason(v.reason)) throw new Error(`Invalid close reason: ${String(v.reason)}`)
  return { issueRef, state: 'closed', reason: v.reason }
}

function nameList(value: unknown, max: number, what: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`Invalid ${what}`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`Invalid ${what}`)
    const name = item.trim()
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  if (out.length > max) throw new Error(`Too many ${what}`)
  return out
}

/** 제목·본문 모양만 검사한다(빈 제목은 결과 값 empty_title). 라벨·담당자는 앞뒤 공백을 지우고 중복을 뺀다 */
export function parseCreateIssueRequest(value: unknown): Required<CreateIssueRequest> {
  const v = record(value, 'create issue')
  assertRepoId(v.repoId)
  if (typeof v.title !== 'string') throw new Error('Invalid issue title')
  if (v.body !== undefined && v.body !== null && typeof v.body !== 'string') {
    throw new Error('Invalid issue body')
  }
  return {
    repoId: v.repoId,
    title: v.title,
    body: typeof v.body === 'string' ? v.body : '',
    labels: nameList(v.labels, MAX_ISSUE_LABELS, 'labels'),
    assignees: nameList(v.assignees, MAX_ISSUE_ASSIGNEES, 'assignees')
  }
}

export function parseRepoMetaRequest(value: unknown): { repoId: number } {
  const v = record(value, 'repository metadata')
  assertRepoId(v.repoId)
  return { repoId: v.repoId }
}

export function parsePreviewRequest(value: unknown): { repoId: number; text: string } {
  const v = record(value, 'markdown preview')
  assertRepoId(v.repoId)
  if (typeof v.text !== 'string') throw new Error('Invalid markdown text')
  return { repoId: v.repoId, text: v.text }
}

// ───────────────────────── 캐시 변경(순수) ─────────────────────────

/** 반응 그룹 목록에 내 반응을 더하거나 뺀다. 바뀌는 것이 없으면 null */
function toggleReaction(
  groups: readonly ReactionGroup[],
  content: ReactionContent,
  add: boolean
): ReactionGroup[] | null {
  const index = groups.findIndex((g) => g.content === content)
  const group = index >= 0 ? groups[index] : undefined
  if ((group?.viewerHasReacted ?? false) === add) return null
  const next = group
    ? { ...group, count: Math.max(0, group.count + (add ? 1 : -1)), viewerHasReacted: add }
    : { content, count: 1, viewerHasReacted: true }
  return group ? groups.map((g, i) => (i === index ? next : g)) : [...groups, next]
}

function reactInRecord(
  detail: IssueDetailRecord,
  subjectId: string,
  content: ReactionContent,
  add: boolean
): IssueDetailRecord | null {
  if (detail.id === subjectId) {
    const reactions = toggleReaction(detail.reactions, content, add)
    return reactions === null ? null : { ...detail, reactions }
  }
  const index = detail.comments.findIndex((c) => c.id === subjectId)
  const comment = detail.comments[index]
  if (comment === undefined) return null
  const reactions = toggleReaction(comment.reactions, content, add)
  if (reactions === null) return null
  return {
    ...detail,
    comments: detail.comments.map((c, i) => (i === index ? { ...comment, reactions } : c))
  }
}

function hasSubject(detail: IssueDetail, subjectId: string): boolean {
  return detail.id === subjectId || detail.comments.some((c) => c.id === subjectId)
}

// ───────────────────────── 응답 → 레코드 ─────────────────────────

interface RawRestUser {
  login?: unknown
  avatar_url?: unknown
  type?: unknown
}

interface RawCreatedIssue {
  node_id?: unknown
  number?: unknown
  title?: unknown
  html_url?: unknown
  user?: RawRestUser | null
  labels?: unknown
  assignees?: unknown
  comments?: unknown
  author_association?: unknown
  created_at?: unknown
  updated_at?: unknown
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function restActor(raw: RawRestUser | null | undefined): IssueRecord['author'] {
  const login = text(raw?.login) ?? 'ghost'
  return {
    login,
    avatarUrl: text(raw?.avatar_url),
    isBot: raw?.type === 'Bot' || login.toLowerCase().endsWith('[bot]')
  }
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** POST /repos/{o}/{r}/issues 응답 → 이슈 목록 행. 노드 ID·번호가 없으면 null */
function createdIssueRecord(
  raw: RawCreatedIssue | null,
  repo: { id: number; fullName: string },
  title: string,
  now: string
): IssueRecord | null {
  if (raw === null || typeof raw !== 'object') return null
  const nodeId = text(raw.node_id)
  const number = raw.number
  if (nodeId === null || typeof number !== 'number') return null
  const createdAt = text(raw.created_at) ?? now
  return {
    id: nodeId,
    repoId: repo.id,
    repoFullName: repo.fullName,
    number,
    title: text(raw.title) ?? title,
    url: text(raw.html_url) ?? '',
    author: restActor(raw.user),
    labels: array(raw.labels).flatMap((l) => {
      const label = l as { name?: unknown; color?: unknown } | null
      const name = text(label?.name)
      return name === null ? [] : [{ name, color: text(label?.color) }]
    }),
    assignees: array(raw.assignees).flatMap((a) =>
      text((a as RawRestUser | null)?.login) === null ? [] : [restActor(a as RawRestUser)]
    ),
    commentCount: typeof raw.comments === 'number' ? raw.comments : 0,
    createdAt,
    updatedAt: text(raw.updated_at) ?? createdAt,
    authorAssociation: text(raw.author_association),
    viewerIsAuthor: true,
    hasWriteHolderResponse: false
  }
}

function labelOption(raw: unknown): RepoLabelOption[] {
  const v = raw as { name?: unknown; color?: unknown; description?: unknown } | null
  const name = text(v?.name)
  return name === null ? [] : [{ name, color: text(v?.color), description: text(v?.description) }]
}

function assigneeOption(raw: unknown): RepoAssigneeOption[] {
  const v = raw as RawRestUser | null
  const login = text(v?.login)
  return login === null ? [] : [{ login, avatarUrl: text(v?.avatar_url) }]
}

// ───────────────────────── 서비스 ─────────────────────────

function failed(message: string): { ok: false; reason: 'failed'; message: string } {
  return { ok: false, reason: 'failed', message }
}

function reject(reason: ActionBlockReason | IssueActionRejectReason): IssueActionFailure {
  return { ok: false, reason }
}

function repoRejectReason(
  repo: ReturnType<typeof getIssueTargetRepo>
): IssueRepoRejectReason | null {
  if (repo === null || !repo.isMine) return 'repo_not_mine'
  if (repo.fork) return 'repo_fork'
  if (repo.archived) return 'repo_archived'
  if (!repo.hasIssuesEnabled) return 'repo_issues_disabled'
  return null
}

export function createIssueActionsService(
  options: IssueActionsServiceOptions
): IssueActionsService {
  const { client, notify } = options
  const serialized = createKeyedSerializer()
  const dataGuard = options.dataGuard ?? (() => () => true)
  const now = options.now ?? Date.now
  const maxPages = Math.max(1, Math.floor(options.repoMetaMaxPages ?? REPO_META_LIMITS.maxPages))

  function blockReason(): ActionBlockReason | null {
    return resolveActionBlockReason(readSessionState(options.getSession), client.getStatus())
  }

  function serialize<R extends { ok: boolean }>(
    key: string,
    task: () => Promise<R | IssueActionFailure>
  ): Promise<R | IssueActionFailure> {
    return serialized<R | IssueActionFailure>(key, task, (error) => failed(safeMessage(error)))
  }

  function issueTask(
    ref: IssueRef,
    task: (detail: IssueDetail, db: DatabaseSync) => Promise<IssueActionResult>
  ): Promise<IssueActionResult> {
    return serialize<IssueActionResult>(issueDetailKey(ref), async () => {
      const blocked = blockReason()
      if (blocked !== null) return reject(blocked)
      const db = options.db()
      const detail = getIssueDetail(db, ref.repoId, ref.number)
      if (detail === null) return reject('not_cached')
      return task(detail, db)
    })
  }

  /**
   * 상세 캐시를 먼저 바꾸고(apply) notify → 요청 → 실패면 원문으로 되돌리고 notify.
   * 요청 사이에 로그아웃·계정 전환으로 데이터 세대가 바뀌었으면 되돌리지 않는다(이전 상세를 다시 쓰지 않게).
   */
  async function optimistic(
    db: DatabaseSync,
    ref: IssueRef,
    apply: (detail: IssueDetailRecord) => IssueDetailRecord | null,
    request: () => Promise<unknown>
  ): Promise<IssueActionResult> {
    const keys = issueActionKeys(ref)
    const isCurrent = dataGuard()
    const snapshot: IssueDetailSnapshot | null = patchIssueDetail(db, ref.repoId, ref.number, apply)
    if (snapshot !== null) notify(keys)
    try {
      await request()
      return { ok: true }
    } catch (error) {
      if (snapshot !== null && restoreIssueDetail(db, snapshot, isCurrent)) notify(keys)
      return failed(safeMessage(error))
    }
  }

  function react(request: ReactRequest): Promise<IssueActionResult> {
    const { subjectId, issueRef: ref, content, add } = request
    return issueTask(ref, async (detail, db) => {
      if (!hasSubject(detail, subjectId)) return reject('not_cached')
      if (!detail.viewerCanReact) return reject('not_allowed')
      return optimistic(
        db,
        ref,
        (record) => reactInRecord(record, subjectId, content, add),
        () =>
          add
            ? client.graphql(
                ADD_REACTION_MUTATION,
                { subjectId, content },
                { operationName: OPERATIONS.addReaction }
              )
            : client.graphql(
                REMOVE_REACTION_MUTATION,
                { subjectId, content },
                { operationName: OPERATIONS.removeReaction }
              )
      )
    })
  }

  function comment(request: CommentRequest): Promise<IssueActionResult> {
    const { issueRef: ref, body } = request
    if (body.trim() === '') return Promise.resolve(reject('empty_body'))
    return issueTask(ref, async (detail, db) => {
      if (!detail.viewerCanComment) return reject('not_allowed')
      const isCurrent = dataGuard()
      let node: RawIssueComment | null | undefined
      try {
        const res = await client.graphql<{
          addComment?: { commentEdge?: { node?: RawIssueComment | null } | null } | null
        }>(
          ADD_COMMENT_MUTATION,
          { subjectId: detail.id, body },
          { operationName: OPERATIONS.addComment }
        )
        node = res.data.addComment?.commentEdge?.node
      } catch (error) {
        return failed(safeMessage(error))
      }
      if (!isCurrent()) return { ok: true }
      const added = node ? mapIssueComment(node) : null
      const changed = patchIssueDetail(db, ref.repoId, ref.number, (record) => {
        // 받은 코멘트가 앞부분 일부뿐이면(전체 수보다 적으면) 끝에 붙이지 않고 수만 늘린다
        const complete = record.comments.length >= record.commentCount
        const duplicate = added !== null && record.comments.some((c) => c.id === added.id)
        return {
          ...record,
          comments:
            added !== null && complete && !duplicate
              ? [...record.comments, added]
              : record.comments,
          commentCount: duplicate ? record.commentCount : record.commentCount + 1
        }
      })
      if (changed !== null) notify(issueActionKeys(ref))
      return { ok: true }
    })
  }

  function setState(request: SetIssueStateRequest): Promise<IssueActionResult> {
    const { issueRef: ref, state } = request
    return issueTask(ref, async (detail, db) => {
      if (state === 'closed') {
        if (!detail.viewerCanClose) return reject('not_allowed')
        const reason = request.reason ?? 'completed'
        const result = await optimistic(
          db,
          ref,
          // 닫을 수 있는 사람이 닫았으면 다시 열 수 있다(다음 상세 갱신이 GitHub 값으로 바로잡는다)
          (record) => ({ ...record, state: 'closed', stateReason: reason, viewerCanReopen: true }),
          () =>
            client.graphql(
              CLOSE_ISSUE_MUTATION,
              {
                issueId: detail.id,
                stateReason: reason === 'not_planned' ? 'NOT_PLANNED' : 'COMPLETED'
              },
              { operationName: OPERATIONS.closeIssue }
            )
        )
        if (result.ok) {
          // 앱에서 만든 이슈였다면 유예 기록을 지워 다음 목록 갱신에서 남지 않게 한다
          forgetCreatedIssue(db, detail.id)
          requestListRefresh()
        }
        return result
      }
      if (!detail.viewerCanReopen) return reject('not_allowed')
      const result = await optimistic(
        db,
        ref,
        (record) => ({ ...record, state: 'open', stateReason: null, viewerCanClose: true }),
        () =>
          client.graphql(
            REOPEN_ISSUE_MUTATION,
            { issueId: detail.id },
            { operationName: OPERATIONS.reopenIssue }
          )
      )
      if (result.ok) requestListRefresh()
      return result
    })
  }

  /** 닫힌 이슈가 열린 이슈 목록에서 빠지도록 목록을 새로 받게 한다. 기다리지 않고 실패는 무시한다 */
  function requestListRefresh(): void {
    const refresh = options.refreshIssueLists
    if (!refresh) return
    try {
      void refresh().catch(() => undefined)
    } catch {
      // 엔진이 없거나 바로 던져도 쓰기 결과에는 영향이 없다
    }
  }

  function create(request: CreateIssueRequest): Promise<CreateIssueResult> {
    const title = request.title.trim()
    if (title === '') return Promise.resolve(reject('empty_title'))
    const { repoId } = request
    return serialize<CreateIssueResult>(`create:${repoId}`, async () => {
      const blocked = blockReason()
      if (blocked !== null) return reject(blocked)
      const db = options.db()
      const repo = getIssueTargetRepo(db, repoId)
      const rejected = repoRejectReason(repo)
      if (rejected !== null || repo === null) return reject(rejected ?? 'repo_not_mine')
      const body: Record<string, unknown> = { title }
      if (request.body && request.body.trim() !== '') body.body = request.body
      if (request.labels && request.labels.length > 0) body.labels = request.labels
      if (request.assignees && request.assignees.length > 0) body.assignees = request.assignees
      const isCurrent = dataGuard()
      let raw: RawCreatedIssue | null
      try {
        const res = await client.post<RawCreatedIssue | null>(
          `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`,
          body
        )
        raw = res.data
      } catch (error) {
        return failed(safeMessage(error))
      }
      const issue = createdIssueRecord(
        raw,
        { id: repo.id, fullName: repo.fullName },
        title,
        new Date().toISOString()
      )
      if (issue === null) return failed('GitHub returned an unexpected response')
      // GitHub 검색 반영이 늦으므로 "내 이슈"에 바로 넣는다
      if (isCurrent()) {
        // 검색으로 목록을 다시 써도 유예 시간 동안 남도록 만든 시각과 함께 기록한다
        recordCreatedIssue(db, issue, now())
        notify([...CREATE_ISSUE_KEYS])
      }
      return { ok: true, issue: { repoId: repo.id, number: issue.number, nodeId: issue.id } }
    })
  }

  async function repoMeta(repoId: number): Promise<RepoMetaResult> {
    const blocked = blockReason()
    if (blocked !== null) return reject(blocked)
    const repo = getIssueTargetRepo(options.db(), repoId)
    const rejected = repoRejectReason(repo)
    if (rejected !== null || repo === null) return reject(rejected ?? 'repo_not_mine')
    const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
    const pageOptions = { query: { per_page: REPO_META_LIMITS.perPage }, maxPages }
    try {
      const labels = await client.getAllPages<unknown>(`${base}/labels`, pageOptions)
      const assignees = await client.getAllPages<unknown>(`${base}/assignees`, pageOptions)
      return {
        ok: true,
        labels: labels.flatMap(labelOption),
        assignees: assignees.flatMap(assigneeOption)
      }
    } catch (error) {
      return failed(safeMessage(error))
    }
  }

  async function previewMarkdown(repoId: number, markdown: string): Promise<MarkdownPreviewResult> {
    if (markdown.trim() === '') return { ok: true, html: '' }
    const blocked = blockReason()
    if (blocked !== null) return reject(blocked)
    const context = lookupRepoFullName(options.db(), repoId)
    const body: Record<string, unknown> = { text: markdown, mode: 'gfm' }
    if (context !== null) body.context = context
    try {
      const res = await client.post<string>('/markdown', body, { responseType: 'text' })
      return { ok: true, html: typeof res.data === 'string' ? res.data : '' }
    } catch (error) {
      return failed(safeMessage(error))
    }
  }

  return { react, comment, setState, create, repoMeta, previewMarkdown }
}
