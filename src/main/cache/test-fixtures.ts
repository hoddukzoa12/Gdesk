import type {
  IssueDetailRecord,
  IssueRecord,
  NotificationRecord,
  PullRequestRecord,
  RepositoryDetailRecord,
  RepositoryRecord
} from './types'

/** 테스트 전용 값 생성기 */

export function repoRecord(id: number, patch: Partial<RepositoryRecord> = {}): RepositoryRecord {
  const owner = patch.owner ?? 'me'
  const name = patch.name ?? `repo${id}`
  return {
    id,
    nodeId: `R_${id}`,
    owner,
    ownerType: 'User',
    ownerAvatarUrl: null,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    private: false,
    fork: false,
    archived: false,
    description: null,
    homepageUrl: null,
    primaryLanguage: 'TypeScript',
    primaryLanguageColor: '#3178c6',
    defaultBranch: 'main',
    license: 'MIT',
    stargazerCount: 10,
    forkCount: 1,
    openPullRequestCount: 0,
    openIssueCount: 0,
    pushedAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    topics: [],
    viewerPermission: 'ADMIN',
    viewerHasStarred: false,
    hasIssuesEnabled: true,
    ...patch
  }
}

export function prRecord(
  id: string,
  repoId: number,
  patch: Partial<PullRequestRecord> = {}
): PullRequestRecord {
  return {
    id,
    repoId,
    repoFullName: `me/repo${repoId}`,
    number: 1,
    title: `PR ${id}`,
    url: `https://github.com/me/repo${repoId}/pull/1`,
    author: { login: 'someone', avatarUrl: null, isBot: false },
    state: 'open',
    reviewStatus: 'none',
    ciStatus: 'none',
    commentCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    authorAssociation: 'CONTRIBUTOR',
    viewerIsAuthor: false,
    hasWriteHolderResponse: false,
    ...patch
  }
}

export function issueRecord(
  id: string,
  repoId: number,
  patch: Partial<IssueRecord> = {}
): IssueRecord {
  return {
    id,
    repoId,
    repoFullName: `me/repo${repoId}`,
    number: 1,
    title: `Issue ${id}`,
    url: `https://github.com/me/repo${repoId}/issues/1`,
    author: { login: 'someone', avatarUrl: null, isBot: false },
    labels: [],
    assignees: [],
    commentCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    authorAssociation: 'NONE',
    viewerIsAuthor: false,
    hasWriteHolderResponse: false,
    ...patch
  }
}

export function notificationRecord(
  threadId: string,
  patch: Partial<NotificationRecord> = {}
): NotificationRecord {
  return {
    threadId,
    state: 'unread',
    reason: 'mention',
    subjectTitle: `Thread ${threadId}`,
    subjectType: 'Issue',
    subjectApiUrl: null,
    url: 'https://github.com/me/repo1/issues/1',
    repoId: 1,
    repoFullName: 'me/repo1',
    updatedAt: '2026-10-01T00:00:00Z',
    ...patch
  }
}

export function detailRecord(
  repo: RepositoryRecord,
  patch: Partial<RepositoryDetailRecord> = {}
): RepositoryDetailRecord {
  return {
    repository: repo,
    openPullRequests: [],
    openIssues: [],
    commits: [],
    latestRelease: null,
    releaseCount: 0,
    releases: [],
    languages: [],
    contributors: [],
    contributorCount: null,
    stargazers: [],
    starsSince: null,
    starsTruncated: false,
    ...patch
  }
}

export function issueDetailRecord(
  repoId: number,
  number: number,
  patch: Partial<IssueDetailRecord> = {}
): IssueDetailRecord {
  return {
    id: `I_${repoId}_${number}`,
    repoId,
    repoFullName: `me/repo${repoId}`,
    number,
    url: `https://github.com/me/repo${repoId}/issues/${number}`,
    title: `Issue ${number}`,
    state: 'open',
    stateReason: null,
    author: { login: 'someone', avatarUrl: null, isBot: false },
    createdAt: '2026-10-01T00:00:00Z',
    bodyHTML: '',
    labels: [],
    assignees: [],
    reactions: [],
    comments: [],
    commentCount: 0,
    linkedPullRequests: [],
    referencingCommits: [],
    locked: false,
    viewerCanClose: true,
    viewerCanReopen: false,
    viewerCanReact: true,
    viewerPermission: 'ADMIN',
    ...patch
  }
}
