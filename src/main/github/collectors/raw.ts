/** GitHub 응답 조각의 형태(필요한 필드만). 응답은 믿지 않고 map.ts 가 방어적으로 읽는다 */
import type { RawActor } from '../../domain/actor'

export interface RawPageInfo {
  hasNextPage?: boolean | null
  endCursor?: string | null
}

export interface RawRepository {
  id?: string | null
  databaseId?: number | null
  name?: string | null
  nameWithOwner?: string | null
  url?: string | null
  isPrivate?: boolean | null
  isFork?: boolean | null
  isArchived?: boolean | null
  description?: string | null
  homepageUrl?: string | null
  owner?: RawActor | null
  primaryLanguage?: { name?: string | null; color?: string | null } | null
  defaultBranchRef?: { name?: string | null } | null
  licenseInfo?: { spdxId?: string | null; name?: string | null } | null
  stargazerCount?: number | null
  forkCount?: number | null
  pullRequests?: { totalCount?: number | null } | null
  issues?: { totalCount?: number | null } | null
  pushedAt?: string | null
  updatedAt?: string | null
  repositoryTopics?: {
    nodes?: ({ topic?: { name?: string | null } | null } | null)[] | null
  } | null
  viewerPermission?: string | null
  viewerHasStarred?: boolean | null
}

export interface RawResponses {
  totalCount?: number | null
  nodes?: ({ authorAssociation?: string | null } | null)[] | null
}

export interface RawPullRequest {
  __typename?: string
  id?: string | null
  number?: number | null
  title?: string | null
  url?: string | null
  isDraft?: boolean | null
  createdAt?: string | null
  updatedAt?: string | null
  reviewDecision?: string | null
  authorAssociation?: string | null
  author?: RawActor | null
  repository?: { databaseId?: number | null; nameWithOwner?: string | null } | null
  comments?: RawResponses | null
  reviews?: RawResponses | null
  commits?: {
    nodes?:
      ({ commit?: { statusCheckRollup?: { state?: string | null } | null } | null } | null)[] | null
  } | null
}

export interface RawIssue {
  __typename?: string
  id?: string | null
  number?: number | null
  title?: string | null
  url?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  authorAssociation?: string | null
  author?: RawActor | null
  repository?: { databaseId?: number | null; nameWithOwner?: string | null } | null
  labels?: { nodes?: ({ name?: string | null; color?: string | null } | null)[] | null } | null
  comments?: RawResponses | null
}

export interface RawConnection<T> {
  totalCount?: number | null
  pageInfo?: RawPageInfo | null
  nodes?: (T | null)[] | null
}

export interface RawCommit {
  oid?: string | null
  abbreviatedOid?: string | null
  messageHeadline?: string | null
  committedDate?: string | null
  url?: string | null
  author?: { name?: string | null; user?: RawActor | null } | null
  statusCheckRollup?: { state?: string | null } | null
}

export interface RawRelease {
  id?: string | null
  tagName?: string | null
  name?: string | null
  publishedAt?: string | null
  createdAt?: string | null
  isPrerelease?: boolean | null
  isDraft?: boolean | null
  isLatest?: boolean | null
  url?: string | null
}

export interface RawRepositoryDetail extends RawRepository {
  openPullRequests?: RawConnection<RawPullRequest> | null
  openIssues?: RawConnection<RawIssue> | null
  defaultBranchRef?: {
    name?: string | null
    target?: { history?: { nodes?: (RawCommit | null)[] | null } | null } | null
  } | null
  latestRelease?: RawRelease | null
  releases?: RawConnection<RawRelease> | null
  languages?: {
    totalSize?: number | null
    edges?:
      | ({
          size?: number | null
          node?: { name?: string | null; color?: string | null } | null
        } | null)[]
      | null
  } | null
}

/** REST GET /notifications 항목 */
export interface RawNotification {
  id?: string | number | null
  unread?: boolean | null
  reason?: string | null
  updated_at?: string | null
  subject?: { title?: string | null; url?: string | null; type?: string | null } | null
  repository?: { id?: number | null; full_name?: string | null; html_url?: string | null } | null
}

/** REST GET /repos/{o}/{r}/contributors 항목 */
export interface RawContributor {
  login?: string | null
  avatar_url?: string | null
  html_url?: string | null
  contributions?: number | null
  type?: string | null
}

/** REST stargazers (Accept: application/vnd.github.star+json) 항목 */
export interface RawStargazer {
  starred_at?: string | null
  user?: { login?: string | null } | null
}

/** REST GET /repositories/{id} */
export interface RawRestRepository {
  id?: number | null
  node_id?: string | null
  full_name?: string | null
}
