/**
 * 수집기가 보내는 GraphQL 문서와 REST 경로.
 * 모든 GraphQL 쿼리는 고유한 operationName 을 가진다. 테스트용 가짜 GitHub 서버는 GraphQL 을
 * operationName 으로, REST 를 "메서드 + 경로" 로 구분해 응답한다.
 */

export const OPERATIONS = {
  myRepositories: 'GdeskMyRepositories',
  starredRepositories: 'GdeskStarredRepositories',
  repoOpenItems: 'GdeskRepoOpenItems',
  myPullRequests: 'GdeskMyPullRequests',
  reviewRequests: 'GdeskReviewRequests',
  assignedIssues: 'GdeskAssignedIssues',
  myIssues: 'GdeskMyIssues',
  repositoryDetail: 'GdeskRepositoryDetail'
} as const

export type OperationName = (typeof OPERATIONS)[keyof typeof OPERATIONS]

/** 가짜 서버 구현용 REST 경로 목록(경로 변수는 {중괄호}) */
export const REST_ENDPOINTS = {
  notifications: 'GET /notifications',
  repositoryById: 'GET /repositories/{repository_id}',
  contributors: 'GET /repos/{owner}/{repo}/contributors',
  stargazers: 'GET /repos/{owner}/{repo}/stargazers'
} as const

/** 검색 쿼리(가짜 서버가 변수 q 를 확인할 때 쓸 수 있다) */
export const SEARCH_QUERIES = {
  myPullRequests: 'is:pr is:open author:@me sort:updated-desc',
  reviewRequests: 'is:pr is:open review-requested:@me sort:updated-desc',
  assignedIssues: 'is:issue is:open assignee:@me sort:updated-desc',
  myIssues: 'is:issue is:open author:@me sort:updated-desc'
} as const

/**
 * 응답 없는 새 기여 판정에 쓰는 코멘트·리뷰 개수(조정 가능, 변수 $responseCount).
 * 메인테이너 답글은 대개 나중에 달리므로 가장 최근 것(last)부터 받는다.
 * 알려진 근사: 전체가 이보다 많은데 받은 것 중 쓰기 권한자가 없으면 응답한 것으로 본다(보수적).
 */
export const RESPONSE_SAMPLE = 50

/** 목록 상한 기본값(조정 가능). 잘린 목록은 캐시가 완전하지 않음으로 표시한다 */
export const LIST_LIMITS = {
  /** 저장소마다 받는 열린 PR·이슈 수(들어온 목록) */
  repoOpenItems: 50,
  /** 저장소 상세의 열린 PR·이슈 수 */
  detailOpenItems: 30,
  /** 검색 목록 페이지 크기·최대 페이지 수 */
  searchPageSize: 50,
  searchMaxPages: 4,
  /** 알림 페이지 크기·최대 페이지 수 */
  notificationsPerPage: 50,
  notificationsMaxPages: 5
} as const

const REPOSITORY_FRAGMENT = `
fragment GdeskRepo on Repository {
  id
  databaseId
  name
  nameWithOwner
  url
  isPrivate
  isFork
  isArchived
  description
  homepageUrl
  owner { __typename login avatarUrl }
  primaryLanguage { name color }
  defaultBranchRef { name }
  licenseInfo { spdxId name }
  stargazerCount
  forkCount
  pullRequests(states: OPEN) { totalCount }
  issues(states: OPEN) { totalCount }
  pushedAt
  updatedAt
  repositoryTopics(first: 20) { nodes { topic { name } } }
  viewerPermission
  viewerHasStarred
}`

const PULL_REQUEST_FRAGMENT = `
fragment GdeskPullRequest on PullRequest {
  __typename
  id
  number
  title
  url
  isDraft
  createdAt
  updatedAt
  reviewDecision
  authorAssociation
  author { __typename login avatarUrl }
  repository { databaseId nameWithOwner }
  comments(last: $responseCount) { totalCount nodes { authorAssociation } }
  reviews(last: $responseCount) { totalCount nodes { authorAssociation } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

const ISSUE_FRAGMENT = `
fragment GdeskIssue on Issue {
  __typename
  id
  number
  title
  url
  createdAt
  updatedAt
  authorAssociation
  author { __typename login avatarUrl }
  repository { databaseId nameWithOwner }
  labels(first: 10) { nodes { name color } }
  comments(last: $responseCount) { totalCount nodes { authorAssociation } }
}`

const RELEASE_FRAGMENT = `
fragment GdeskRelease on Release {
  id
  tagName
  name
  publishedAt
  createdAt
  isPrerelease
  isDraft
  isLatest
  url
}`

export const MY_REPOSITORIES_QUERY = `
query GdeskMyRepositories($cursor: String, $pageSize: Int!) {
  viewer {
    login
    repositories(
      first: $pageSize
      after: $cursor
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { ...GdeskRepo }
    }
  }
}
${REPOSITORY_FRAGMENT}`

export const STARRED_REPOSITORIES_QUERY = `
query GdeskStarredRepositories($cursor: String, $pageSize: Int!) {
  viewer {
    starredRepositories(
      first: $pageSize
      after: $cursor
      orderBy: { field: STARRED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      edges { starredAt node { ...GdeskRepo } }
    }
  }
}
${REPOSITORY_FRAGMENT}`

export const REPO_OPEN_ITEMS_QUERY = `
query GdeskRepoOpenItems($ids: [ID!]!, $itemCount: Int!, $responseCount: Int!) {
  viewer { login }
  nodes(ids: $ids) {
    ... on Repository {
      databaseId
      openPullRequests: pullRequests(
        states: OPEN
        first: $itemCount
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes { ...GdeskPullRequest }
      }
      openIssues: issues(
        states: OPEN
        first: $itemCount
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes { ...GdeskIssue }
      }
    }
  }
}
${PULL_REQUEST_FRAGMENT}
${ISSUE_FRAGMENT}`

function searchQuery(operationName: string, fragment: 'GdeskPullRequest' | 'GdeskIssue'): string {
  return `
query ${operationName}($q: String!, $cursor: String, $pageSize: Int!, $responseCount: Int!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $pageSize, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { __typename ...${fragment} }
  }
}
${fragment === 'GdeskPullRequest' ? PULL_REQUEST_FRAGMENT : ISSUE_FRAGMENT}`
}

export const MY_PULL_REQUESTS_QUERY = searchQuery(OPERATIONS.myPullRequests, 'GdeskPullRequest')
export const REVIEW_REQUESTS_QUERY = searchQuery(OPERATIONS.reviewRequests, 'GdeskPullRequest')
export const ASSIGNED_ISSUES_QUERY = searchQuery(OPERATIONS.assignedIssues, 'GdeskIssue')
export const MY_ISSUES_QUERY = searchQuery(OPERATIONS.myIssues, 'GdeskIssue')

export const REPOSITORY_DETAIL_QUERY = `
query GdeskRepositoryDetail(
  $id: ID!
  $itemCount: Int!
  $commitCount: Int!
  $releaseCount: Int!
  $responseCount: Int!
) {
  viewer { login }
  node(id: $id) {
    ... on Repository {
      ...GdeskRepo
      openPullRequests: pullRequests(
        states: OPEN
        first: $itemCount
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes { ...GdeskPullRequest }
      }
      openIssues: issues(
        states: OPEN
        first: $itemCount
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes { ...GdeskIssue }
      }
      defaultBranchRef {
        name
        target {
          ... on Commit {
            history(first: $commitCount) {
              nodes {
                oid
                abbreviatedOid
                messageHeadline
                committedDate
                url
                author { name user { __typename login avatarUrl } }
                statusCheckRollup { state }
              }
            }
          }
        }
      }
      latestRelease { ...GdeskRelease }
      releases(first: $releaseCount, orderBy: { field: CREATED_AT, direction: DESC }) {
        totalCount
        nodes { ...GdeskRelease }
      }
      languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
        totalSize
        edges { size node { name color } }
      }
    }
  }
}
${REPOSITORY_FRAGMENT}
${PULL_REQUEST_FRAGMENT}
${ISSUE_FRAGMENT}
${RELEASE_FRAGMENT}`
