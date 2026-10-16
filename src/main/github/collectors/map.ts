import { CONTRIBUTION_LEVELS } from '@shared/domain/home-activity'
import type { RecentCommit } from '@shared/domain/home-activity'
import type { ViewerPermission } from '@shared/domain/repo'
import type { ActorSummary } from '@shared/domain/actor'
import type { IssueLabel } from '@shared/domain/issue'
import { REACTION_CONTENTS } from '@shared/domain/issue-detail'
import type {
  IssueComment,
  LinkedPullRequest,
  LinkedPullRequestState,
  ReactionGroup,
  ReferencingCommit
} from '@shared/domain/issue-detail'
import { toActor } from '../../domain/actor'
import type { RawActor } from '../../domain/actor'
import { ciStatusFromRollup } from '../../domain/ci'
import { hasWriteHolderResponse } from '../../domain/contribution'
import { notificationHtmlUrl } from '../../domain/notification-url'
import { prStateFromDraft, reviewStatusFromDecision } from '../../domain/review'
import type { ContributionDayRecord, ContributionsRecord } from '../../cache/home-activity'
import type {
  CommitRecord,
  IssueDetailRecord,
  IssueRecord,
  NotificationRecord,
  PullRequestRecord,
  ReleaseRecord,
  RepositoryRecord
} from '../../cache/types'
import type {
  RawCommit,
  RawCommitSearchItem,
  RawContributionsViewer,
  RawIssue,
  RawIssueComment,
  RawIssueDetailRepository,
  RawIssueTimelineItem,
  RawLinkedPullRequest,
  RawReactionGroup,
  RawNotification,
  RawPullRequest,
  RawRelease,
  RawRepository,
  RawResponses
} from './raw'

/** GitHub 응답 → 캐시 기록. 필수 필드가 없으면 null(건너뜀) */

const PERMISSIONS: readonly ViewerPermission[] = ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ']

function compact<T>(list: readonly (T | null | undefined)[] | null | undefined): T[] {
  return (list ?? []).filter((x): x is T => x !== null && x !== undefined)
}

export function mapRepository(raw: RawRepository | null | undefined): RepositoryRecord | null {
  if (!raw || typeof raw.databaseId !== 'number' || !raw.nameWithOwner) return null
  const [ownerFromName = '', nameFromName = ''] = raw.nameWithOwner.split('/')
  const license = raw.licenseInfo
    ? raw.licenseInfo.spdxId && raw.licenseInfo.spdxId !== 'NOASSERTION'
      ? raw.licenseInfo.spdxId
      : (raw.licenseInfo.name ?? null)
    : null
  return {
    id: raw.databaseId,
    nodeId: raw.id ?? null,
    owner: raw.owner?.login ?? ownerFromName,
    ownerType: raw.owner?.__typename === 'Organization' ? 'Organization' : 'User',
    ownerAvatarUrl: raw.owner?.avatarUrl ?? null,
    name: raw.name ?? nameFromName,
    fullName: raw.nameWithOwner,
    url: raw.url ?? '',
    private: raw.isPrivate === true,
    fork: raw.isFork === true,
    archived: raw.isArchived === true,
    description: raw.description ?? null,
    homepageUrl: raw.homepageUrl ? raw.homepageUrl : null,
    primaryLanguage: raw.primaryLanguage?.name ?? null,
    primaryLanguageColor: raw.primaryLanguage?.color ?? null,
    defaultBranch: raw.defaultBranchRef?.name ?? null,
    license,
    stargazerCount: raw.stargazerCount ?? 0,
    forkCount: raw.forkCount ?? 0,
    openPullRequestCount: raw.pullRequests?.totalCount ?? 0,
    openIssueCount: raw.issues?.totalCount ?? 0,
    pushedAt: raw.pushedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    topics: compact(raw.repositoryTopics?.nodes)
      .map((n) => n.topic?.name)
      .filter((n): n is string => typeof n === 'string'),
    viewerPermission: PERMISSIONS.find((p) => p === raw.viewerPermission) ?? null,
    viewerHasStarred: raw.viewerHasStarred === true,
    // 응답에 없으면(예전 응답·가짜 서버) 켜진 것으로 본다. 확실히 false 일 때만 꺼짐
    hasIssuesEnabled: raw.hasIssuesEnabled !== false
  }
}

function responses(...lists: (RawResponses | null | undefined)[]): boolean {
  const nodes = lists.flatMap((l) =>
    compact(l?.nodes).map((n) => ({ authorAssociation: n.authorAssociation ?? null }))
  )
  const total = lists.reduce((n, l) => n + (l?.totalCount ?? compact(l?.nodes).length), 0)
  return hasWriteHolderResponse(nodes, total)
}

function sameLogin(a: string, b: string | null): boolean {
  return b !== null && a.toLowerCase() === b.toLowerCase()
}

export function mapPullRequest(
  raw: RawPullRequest | null | undefined,
  viewerLogin: string | null
): PullRequestRecord | null {
  if (!raw || !raw.id || typeof raw.number !== 'number') return null
  const repoId = raw.repository?.databaseId
  if (typeof repoId !== 'number') return null
  const author = toActor(raw.author)
  const rollup = compact(raw.commits?.nodes)[0]?.commit?.statusCheckRollup?.state
  return {
    id: raw.id,
    repoId,
    repoFullName: raw.repository?.nameWithOwner ?? '',
    number: raw.number,
    title: raw.title ?? '',
    url: raw.url ?? '',
    author,
    state: prStateFromDraft(raw.isDraft),
    reviewStatus: reviewStatusFromDecision(raw.reviewDecision),
    ciStatus: ciStatusFromRollup(rollup),
    commentCount: raw.comments?.totalCount ?? 0,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? raw.createdAt ?? '',
    authorAssociation: raw.authorAssociation ?? null,
    viewerIsAuthor: sameLogin(author.login, viewerLogin),
    hasWriteHolderResponse: responses(raw.comments, raw.reviews)
  }
}

/** 담당자 등 사용자 목록. login 이 없는 항목은 버린다(지워진 계정을 ghost 로 채우지 않음) */
function mapActors(nodes: readonly (RawActor | null)[] | null | undefined): ActorSummary[] {
  return compact(nodes)
    .filter((a) => typeof a.login === 'string' && a.login !== '')
    .map((a) => toActor(a))
}

function mapLabels(raw: RawIssue['labels']): IssueLabel[] {
  return compact(raw?.nodes)
    .filter((l) => typeof l.name === 'string')
    .map((l) => ({ name: l.name as string, color: l.color ?? null }))
}

export function mapIssue(
  raw: RawIssue | null | undefined,
  viewerLogin: string | null
): IssueRecord | null {
  // 검색 결과에 PR 이 섞여 오면(__typename 'PullRequest') 버린다
  if (!raw || raw.__typename === 'PullRequest' || !raw.id || typeof raw.number !== 'number') {
    return null
  }
  const repoId = raw.repository?.databaseId
  if (typeof repoId !== 'number') return null
  const author = toActor(raw.author)
  return {
    id: raw.id,
    repoId,
    repoFullName: raw.repository?.nameWithOwner ?? '',
    number: raw.number,
    title: raw.title ?? '',
    url: raw.url ?? '',
    author,
    labels: mapLabels(raw.labels),
    assignees: mapActors(raw.assignees?.nodes),
    commentCount: raw.comments?.totalCount ?? 0,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? raw.createdAt ?? '',
    authorAssociation: raw.authorAssociation ?? null,
    viewerIsAuthor: sameLogin(author.login, viewerLogin),
    hasWriteHolderResponse: responses(raw.comments)
  }
}

export function mapCommit(raw: RawCommit | null | undefined): CommitRecord | null {
  if (!raw || !raw.oid) return null
  const user = raw.author?.user
  return {
    sha: raw.oid,
    shortSha: raw.abbreviatedOid ?? raw.oid.slice(0, 7),
    message: raw.messageHeadline ?? '',
    author: user ? toActor(user) : null,
    authorName: raw.author?.name ?? null,
    committedAt: raw.committedDate ?? null,
    url: raw.url ?? '',
    ciStatus: ciStatusFromRollup(raw.statusCheckRollup?.state)
  }
}

export function mapRelease(raw: RawRelease | null | undefined): ReleaseRecord | null {
  if (!raw || !raw.id || !raw.tagName) return null
  return {
    id: raw.id,
    tagName: raw.tagName,
    name: raw.name ? raw.name : null,
    publishedAt: raw.publishedAt ?? null,
    createdAt: raw.createdAt ?? raw.publishedAt ?? '',
    isPrerelease: raw.isPrerelease === true,
    isDraft: raw.isDraft === true,
    isLatest: raw.isLatest === true,
    url: raw.url ?? ''
  }
}

export function mapNotification(
  raw: RawNotification | null | undefined
): NotificationRecord | null {
  if (!raw || raw.id === null || raw.id === undefined) return null
  const repoHtml = raw.repository?.html_url ?? ''
  const subjectType = raw.subject?.type ?? ''
  const subjectApiUrl = raw.subject?.url ?? null
  return {
    threadId: String(raw.id),
    state: raw.unread === false ? 'read' : 'unread',
    reason: raw.reason ?? '',
    subjectTitle: raw.subject?.title ?? '',
    subjectType,
    subjectApiUrl,
    url: repoHtml ? notificationHtmlUrl({ type: subjectType, url: subjectApiUrl }, repoHtml) : '',
    repoId: typeof raw.repository?.id === 'number' ? raw.repository.id : null,
    repoFullName: raw.repository?.full_name ?? '',
    updatedAt: raw.updated_at ?? ''
  }
}

/** 기여 달력: 주를 펼쳐 날짜 순. 날짜 없는 칸은 버리고, 모르는 수준은 NONE */
export function mapContributions(
  raw: RawContributionsViewer | null | undefined
): ContributionsRecord | null {
  const collection = raw?.contributionsCollection
  if (!collection) return null
  const days: ContributionDayRecord[] = []
  for (const week of compact(collection.contributionCalendar?.weeks)) {
    for (const d of compact(week.contributionDays)) {
      if (typeof d.date !== 'string' || d.date === '') continue
      days.push({
        date: d.date,
        count: typeof d.contributionCount === 'number' ? d.contributionCount : 0,
        level: CONTRIBUTION_LEVELS.find((l) => l === d.contributionLevel) ?? 'NONE'
      })
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { totalCommitContributions: collection.totalCommitContributions ?? 0, days }
}

/** 커밋 검색 항목 → 최근 커밋. sha·저장소가 없으면 null. 메시지는 첫 줄만 */
export function mapCommitSearchItem(
  raw: RawCommitSearchItem | null | undefined
): RecentCommit | null {
  const repoFullName = raw?.repository?.full_name
  if (!raw || !raw.sha || !repoFullName) return null
  return {
    repoFullName,
    sha: raw.sha,
    message: (raw.commit?.message ?? '').split(/\r?\n/, 1)[0] ?? '',
    authorAvatarUrl: raw.author?.avatar_url ?? null,
    authorDate: raw.commit?.author?.date ?? null,
    url: raw.html_url ?? ''
  }
}

/** 반응 그룹. 모르는 반응 종류는 버린다. 0 명인 그룹도 남긴다(GitHub 가 주는 그대로) */
export function mapReactionGroups(
  raw: readonly (RawReactionGroup | null)[] | null | undefined
): ReactionGroup[] {
  const out: ReactionGroup[] = []
  for (const g of compact(raw)) {
    const content = REACTION_CONTENTS.find((c) => c === g.content)
    if (!content) continue
    out.push({
      content,
      count: Math.max(0, g.reactors?.totalCount ?? 0),
      viewerHasReacted: g.viewerHasReacted === true
    })
  }
  return out
}

function mapIssueComment(raw: RawIssueComment): IssueComment | null {
  if (!raw.id) return null
  return {
    id: raw.id,
    author: toActor(raw.author),
    createdAt: raw.createdAt ?? '',
    bodyHTML: raw.bodyHTML ?? '',
    reactions: mapReactionGroups(raw.reactionGroups)
  }
}

function linkedPullRequestState(state: string | null | undefined): LinkedPullRequestState {
  if (state === 'MERGED') return 'merged'
  if (state === 'CLOSED') return 'closed'
  return 'open'
}

/** ReferencedSubject 중 PullRequest 만 연결된 PR 로 본다(이 이슈 자신이나 다른 이슈는 버린다) */
function mapLinkedPullRequest(
  raw: RawLinkedPullRequest | null | undefined
): LinkedPullRequest | null {
  if (!raw || raw.__typename !== 'PullRequest' || typeof raw.number !== 'number') return null
  const repoFullName = raw.repository?.nameWithOwner
  if (!repoFullName) return null
  return {
    number: raw.number,
    title: raw.title ?? '',
    state: linkedPullRequestState(raw.state),
    repoFullName,
    url: raw.url ?? ''
  }
}

/**
 * 연결된 PR: 닫는 PR(closedByPullRequestsReferences) → 타임라인 순서. 같은 PR 은 한 번만(처음 자리).
 * 사이드바 연결(ConnectedEvent)은 뒤의 DisconnectedEvent 로 풀리면 뺀다. 교차 참조·닫는 PR 은 남는다.
 */
function mapLinkedPullRequests(
  closing: readonly (RawLinkedPullRequest | null)[] | null | undefined,
  timeline: readonly RawIssueTimelineItem[]
): LinkedPullRequest[] {
  const entries = new Map<string, { pr: LinkedPullRequest; sources: Set<string> }>()
  const add = (pr: LinkedPullRequest | null, source: string): void => {
    if (!pr) return
    const key = `${pr.repoFullName.toLowerCase()}#${pr.number}`
    const entry = entries.get(key)
    if (entry) entry.sources.add(source)
    else entries.set(key, { pr, sources: new Set([source]) })
  }
  for (const pr of compact(closing)) add(mapLinkedPullRequest(pr), 'closing')
  for (const item of timeline) {
    if (item.__typename === 'CrossReferencedEvent') {
      add(mapLinkedPullRequest(item.source), 'reference')
    } else if (item.__typename === 'ConnectedEvent') {
      add(mapLinkedPullRequest(item.source) ?? mapLinkedPullRequest(item.subject), 'connected')
    } else if (item.__typename === 'DisconnectedEvent') {
      const pr = mapLinkedPullRequest(item.source) ?? mapLinkedPullRequest(item.subject)
      if (pr)
        entries.get(`${pr.repoFullName.toLowerCase()}#${pr.number}`)?.sources.delete('connected')
    }
  }
  return [...entries.values()].filter((e) => e.sources.size > 0).map((e) => e.pr)
}

/** 이슈를 참조한 커밋(타임라인 ReferencedEvent). 같은 커밋은 한 번만, 커밋이 없어진 참조는 버린다 */
function mapReferencingCommits(timeline: readonly RawIssueTimelineItem[]): ReferencingCommit[] {
  const seen = new Set<string>()
  const out: ReferencingCommit[] = []
  for (const item of timeline) {
    if (item.__typename !== 'ReferencedEvent') continue
    const commit = item.commit
    if (!commit?.oid || seen.has(commit.oid)) continue
    seen.add(commit.oid)
    const user = commit.author?.user
    out.push({
      sha: commit.oid,
      message: (commit.messageHeadline ?? '').split(/\r?\n/, 1)[0] ?? '',
      author: user && typeof user.login === 'string' && user.login !== '' ? toActor(user) : null,
      authorName: commit.author?.name ?? null,
      committedAt: commit.committedDate ?? null,
      url: commit.url ?? '',
      repoFullName: item.commitRepository?.nameWithOwner ?? ''
    })
  }
  return out
}

const ISSUE_STATE_REASONS = {
  COMPLETED: 'completed',
  NOT_PLANNED: 'not_planned',
  DUPLICATE: 'duplicate'
} as const

/**
 * 이슈 상세 응답 → 기록. 저장소나 이슈가 비어 왔으면(삭제·권한 없음·PR 번호) null.
 * 다시 연 이슈(REOPENED)와 모르는 닫힌 이유는 null 이다.
 */
export function mapIssueDetail(
  raw: RawIssueDetailRepository | null | undefined,
  target: { repoId: number; fullName: string }
): IssueDetailRecord | null {
  const issue = raw?.issue
  if (!raw || !issue || !issue.id || typeof issue.number !== 'number') return null
  const timeline = compact(issue.timelineItems?.nodes)
  const comments = compact(issue.comments?.nodes)
    .map(mapIssueComment)
    .filter((c): c is IssueComment => c !== null)
  const state = issue.state === 'CLOSED' ? 'closed' : 'open'
  const reason = issue.stateReason ?? ''
  return {
    id: issue.id,
    repoId: target.repoId,
    repoFullName: raw.nameWithOwner ?? target.fullName,
    number: issue.number,
    url: issue.url ?? '',
    title: issue.title ?? '',
    state,
    stateReason:
      state === 'closed' && Object.hasOwn(ISSUE_STATE_REASONS, reason)
        ? ISSUE_STATE_REASONS[reason as keyof typeof ISSUE_STATE_REASONS]
        : null,
    author: toActor(issue.author),
    createdAt: issue.createdAt ?? '',
    bodyHTML: issue.bodyHTML ?? '',
    labels: mapLabels(issue.labels),
    assignees: mapActors(issue.assignees?.nodes),
    reactions: mapReactionGroups(issue.reactionGroups),
    comments,
    commentCount: Math.max(issue.comments?.totalCount ?? 0, comments.length),
    linkedPullRequests: mapLinkedPullRequests(
      issue.closedByPullRequestsReferences?.nodes,
      timeline
    ),
    referencingCommits: mapReferencingCommits(timeline),
    locked: issue.locked === true,
    viewerCanClose: issue.viewerCanClose === true,
    viewerCanReopen: issue.viewerCanReopen === true,
    viewerCanReact: issue.viewerCanReact === true,
    viewerPermission: PERMISSIONS.find((p) => p === raw.viewerPermission) ?? null
  }
}

export { compact }
