/**
 * 수집기가 보내는 GraphQL 문서와 REST 경로.
 * 모든 GraphQL 쿼리는 고유한 operationName 을 가진다. 테스트용 가짜 GitHub 서버는 GraphQL 을
 * operationName 으로, REST 를 "메서드 + 경로" 로 구분해 응답한다.
 */

// 상대 경로: 화면 테스트의 가짜 GitHub 서버(Playwright)도 이 파일을 직접 불러온다
import { HOME_RECENT_COMMIT_LIMIT } from '../../../shared/domain/home-activity'

export const OPERATIONS = {
  myRepositories: 'GdeskMyRepositories',
  starredRepositories: 'GdeskStarredRepositories',
  repoOpenItems: 'GdeskRepoOpenItems',
  myPullRequests: 'GdeskMyPullRequests',
  reviewRequests: 'GdeskReviewRequests',
  assignedIssues: 'GdeskAssignedIssues',
  myIssues: 'GdeskMyIssues',
  mentionedIssues: 'GdeskMentionedIssues',
  issueDetail: 'GdeskIssueDetail',
  /** 쓰기 동작(spec §6.3): 반응·코멘트·닫기·다시 열기 */
  addReaction: 'GdeskAddReaction',
  removeReaction: 'GdeskRemoveReaction',
  addComment: 'GdeskAddComment',
  closeIssue: 'GdeskCloseIssue',
  reopenIssue: 'GdeskReopenIssue',
  repositoryDetail: 'GdeskRepositoryDetail',
  contributions: 'GdeskContributions'
} as const

export type OperationName = (typeof OPERATIONS)[keyof typeof OPERATIONS]

/** 가짜 서버 구현용 REST 경로 목록(경로 변수는 {중괄호}) */
export const REST_ENDPOINTS = {
  notifications: 'GET /notifications',
  repositoryById: 'GET /repositories/{repository_id}',
  contributors: 'GET /repos/{owner}/{repo}/contributors',
  stargazers: 'GET /repos/{owner}/{repo}/stargazers',
  /** 내 최근 커밋(q=author:<login>, sort=author-date, order=desc, per_page). 검색 한도(search)를 쓴다 */
  searchCommits: 'GET /search/commits',
  /** 새 이슈(spec §6.3). 본문 { title, body?, labels?: 이름[], assignees?: 로그인[] } → 201 이슈(node_id, number …) */
  createIssue: 'POST /repos/{owner}/{repo}/issues',
  /** 새 이슈 양식의 라벨 선택지(per_page=100, 페이지 상한) */
  repoLabels: 'GET /repos/{owner}/{repo}/labels',
  /** 새 이슈 양식의 담당자 선택지(per_page=100, 페이지 상한) */
  repoAssignees: 'GET /repos/{owner}/{repo}/assignees',
  /** 마크다운 미리보기. 본문 { text, mode: 'gfm', context: 'owner/name' } → text/html */
  renderMarkdown: 'POST /markdown'
} as const

/** 검색 쿼리(가짜 서버가 변수 q 를 확인할 때 쓸 수 있다) */
export const SEARCH_QUERIES = {
  myPullRequests: 'is:pr is:open author:@me sort:updated-desc',
  reviewRequests: 'is:pr is:open review-requested:@me sort:updated-desc',
  assignedIssues: 'is:issue is:open assignee:@me sort:updated-desc',
  myIssues: 'is:issue is:open author:@me sort:updated-desc',
  mentionedIssues: 'is:issue is:open mentions:@me sort:updated-desc'
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
  notificationsMaxPages: 5,
  /** Home 최근 커밋 수(커밋 검색 per_page) */
  recentCommits: HOME_RECENT_COMMIT_LIMIT,
  /** 이슈 목록 행의 담당자 수 */
  issueAssignees: 10,
  /** 이슈 상세: 오래된 것부터 받는 코멘트 수(최대 100) */
  issueDetailComments: 100,
  /** 이슈 상세: 라벨·담당자 수 */
  issueDetailLabels: 50,
  /** 이슈 상세: 닫는 PR 수 */
  issueDetailClosingPullRequests: 25,
  /** 이슈 상세: 연결·참조 타임라인 항목 수(오래된 것부터) */
  issueDetailTimelineItems: 100
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
  hasIssuesEnabled
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
  assignees(first: ${LIST_LIMITS.issueAssignees}) { nodes { __typename login avatarUrl } }
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
export const MENTIONED_ISSUES_QUERY = searchQuery(OPERATIONS.mentionedIssues, 'GdeskIssue')

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

/**
 * 내 기여 달력(최근 12개월). 기간을 주지 않으면 GitHub 는 지금까지 1년을 준다.
 * 주는 일요일에 시작하고 마지막 날이 오늘이다. 커밋 수는 totalCommitContributions 그대로 쓴다.
 */
export const CONTRIBUTIONS_QUERY = `
query GdeskContributions {
  viewer {
    login
    contributionsCollection {
      totalCommitContributions
      contributionCalendar {
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
  }
}`

const REACTION_GROUPS = 'reactionGroups { content viewerHasReacted reactors { totalCount } }'

const LINKED_PULL_REQUEST_FIELDS = '__typename number title state url repository { nameWithOwner }'

/**
 * 이슈 상세 (spec §6.2). 저장소는 캐시의 owner/name 으로 찾는다.
 * - 코멘트: 오래된 것부터 $commentCount 개 + 전체 수
 * - 연결된 PR: 닫는 PR(closedByPullRequestsReferences) + 타임라인의 교차 참조·연결·연결 해제
 * - 참조한 커밋: 타임라인 REFERENCED_EVENT 의 commit
 * - 타임라인은 최근 $timelineCount 개(last)다. 긴 이슈에서도 최근 교차 참조·커밋이 남는다. 순서는 오래된 것 → 최근
 * - 코멘트 가능 여부 계산용으로 저장소의 viewerPermission 을 함께 받는다
 * stateReason 에 enableDuplicate 인자를 넘기지 않는다(DUPLICATE 는 기본으로 오고, 그 인자는 없어진다).
 */
export const ISSUE_DETAIL_QUERY = `
query GdeskIssueDetail(
  $owner: String!
  $name: String!
  $number: Int!
  $commentCount: Int!
  $labelCount: Int!
  $closingCount: Int!
  $timelineCount: Int!
) {
  repository(owner: $owner, name: $name) {
    databaseId
    nameWithOwner
    viewerPermission
    issue(number: $number) {
      id
      number
      url
      title
      state
      stateReason
      locked
      createdAt
      bodyHTML
      author { __typename login avatarUrl }
      labels(first: $labelCount) { nodes { name color } }
      assignees(first: $labelCount) { nodes { __typename login avatarUrl } }
      ${REACTION_GROUPS}
      viewerCanClose
      viewerCanReopen
      viewerCanReact
      comments(first: $commentCount) {
        totalCount
        nodes {
          id
          createdAt
          bodyHTML
          author { __typename login avatarUrl }
          ${REACTION_GROUPS}
        }
      }
      closedByPullRequestsReferences(first: $closingCount, includeClosedPrs: true) {
        nodes { ${LINKED_PULL_REQUEST_FIELDS} }
      }
      timelineItems(
        last: $timelineCount
        itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT, DISCONNECTED_EVENT, REFERENCED_EVENT]
      ) {
        nodes {
          __typename
          ... on CrossReferencedEvent {
            source { ... on PullRequest { ${LINKED_PULL_REQUEST_FIELDS} } }
          }
          ... on ConnectedEvent {
            source { ... on PullRequest { ${LINKED_PULL_REQUEST_FIELDS} } }
            subject { ... on PullRequest { ${LINKED_PULL_REQUEST_FIELDS} } }
          }
          ... on DisconnectedEvent {
            source { ... on PullRequest { ${LINKED_PULL_REQUEST_FIELDS} } }
            subject { ... on PullRequest { ${LINKED_PULL_REQUEST_FIELDS} } }
          }
          ... on ReferencedEvent {
            commitRepository { nameWithOwner }
            commit {
              oid
              messageHeadline
              committedDate
              url
              author { name user { __typename login avatarUrl } }
            }
          }
        }
      }
    }
  }
}`

/**
 * 쓰기 동작 mutation (spec §6.3). 대상은 캐시된 이슈 상세의 노드 ID(이슈·코멘트)다.
 * 응답은 화면 갱신에 쓰지 않는 최소 필드만 받는다(코멘트는 새 코멘트를 상세에 붙이려고 전부 받는다).
 */
export const ADD_REACTION_MUTATION = `
mutation GdeskAddReaction($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $subjectId, content: $content }) {
    reaction { content }
  }
}`

export const REMOVE_REACTION_MUTATION = `
mutation GdeskRemoveReaction($subjectId: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $subjectId, content: $content }) {
    reaction { content }
  }
}`

export const ADD_COMMENT_MUTATION = `
mutation GdeskAddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) {
    commentEdge {
      node {
        id
        createdAt
        bodyHTML
        author { __typename login avatarUrl }
        ${REACTION_GROUPS}
      }
    }
  }
}`

/** $stateReason: COMPLETED | NOT_PLANNED */
export const CLOSE_ISSUE_MUTATION = `
mutation GdeskCloseIssue($issueId: ID!, $stateReason: IssueClosedStateReason) {
  closeIssue(input: { issueId: $issueId, stateReason: $stateReason }) {
    issue { id state stateReason }
  }
}`

export const REOPEN_ISSUE_MUTATION = `
mutation GdeskReopenIssue($issueId: ID!) {
  reopenIssue(input: { issueId: $issueId }) {
    issue { id state stateReason }
  }
}`

/** 새 이슈 양식 선택지 상한(조정 가능): 라벨·담당자 각각 per_page × 최대 페이지(기본 500개) */
export const REPO_META_LIMITS = {
  perPage: 100,
  maxPages: 5
} as const
