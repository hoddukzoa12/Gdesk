import type { ViewerPermission } from '@shared/domain/repo'
import { toActor } from '../../domain/actor'
import { ciStatusFromRollup } from '../../domain/ci'
import { hasWriteHolderResponse } from '../../domain/contribution'
import { notificationHtmlUrl } from '../../domain/notification-url'
import { prStateFromDraft, reviewStatusFromDecision } from '../../domain/review'
import type {
  CommitRecord,
  IssueRecord,
  NotificationRecord,
  PullRequestRecord,
  ReleaseRecord,
  RepositoryRecord
} from '../../cache/types'
import type {
  RawCommit,
  RawIssue,
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
    viewerHasStarred: raw.viewerHasStarred === true
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
    labels: compact(raw.labels?.nodes)
      .filter((l) => typeof l.name === 'string')
      .map((l) => ({ name: l.name as string, color: l.color ?? null })),
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

export { compact }
