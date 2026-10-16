/**
 * 가짜 GitHub 서버의 고정 데이터. 시각은 서버를 띄운 순간(now)을 기준으로 한 상대 시각이라
 * "최근 30일" 같은 계산이 언제 돌려도 같은 결과를 낸다. ID·소유자·개수는 서로 맞물린다:
 * - 저장소의 열린 PR·이슈 수 = items 중 그 저장소 것의 수(응답 때 계산)
 * - 스타 수 = stargazers 길이(쓰기 동작이 함께 바꾼다)
 * - 알림의 저장소 ID·이름 = repos 의 것
 * 화면 테스트가 기대값으로 쓰는 이름·ID 는 FIXTURE 에 모았다.
 */

export type ActorType = 'User' | 'Bot' | 'Organization'
export type Permission = 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ'
/** GraphQL statusCheckRollup.state. null 은 CI 없음 */
export type RollupState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null

export interface FixtureActor {
  id: number
  login: string
  name: string | null
  type: ActorType
}

/** GitHub ReactionContent */
export type ReactionContent =
  'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES'

/** GitHub 가 reactionGroups 로 주는 순서(0 명인 그룹도 온다) */
export const REACTION_CONTENTS: readonly ReactionContent[] = [
  'THUMBS_UP',
  'THUMBS_DOWN',
  'LAUGH',
  'HOORAY',
  'CONFUSED',
  'HEART',
  'ROCKET',
  'EYES'
]

/** 반응: 종류별로 반응한 사람들. 수 = users 길이, viewerHasReacted = viewer 가 들어 있는가 */
export type FixtureReactions = Partial<Record<ReactionContent, string[]>>

export interface FixtureResponse {
  login: string
  /** OWNER·MEMBER·COLLABORATOR 는 쓰기 권한자 */
  authorAssociation: string
  createdAt: string
  /** 코멘트 노드 ID(이슈 코멘트만 쓴다). buildFixtures 가 채운다: IC_kwDO{repoId}_{number}_{순번} */
  id?: string
  /** 이슈 상세의 코멘트 본문 HTML. 없으면 간단한 문단 */
  bodyHTML?: string
  reactions?: FixtureReactions
}

/** 이슈 상세의 연결된 PR(items 에 없어도 된다: 병합·닫힌 PR) */
export interface FixtureLinkedPullRequest {
  /** owner/name */
  repo: string
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
}

/** 이슈 상세 타임라인(연결·참조) */
export type FixtureTimelineEvent =
  | {
      type: 'CrossReferencedEvent' | 'ConnectedEvent' | 'DisconnectedEvent'
      pr: FixtureLinkedPullRequest
    }
  | {
      type: 'ReferencedEvent'
      /** 커밋이 있는 저장소(owner/name) */
      repo: string
      oid: string
      message: string
      committedDate: string
      author: string
    }

export interface FixtureItem {
  kind: 'PullRequest' | 'Issue'
  nodeId: string
  repoId: number
  number: number
  title: string
  author: string
  authorAssociation: string
  createdAt: string
  updatedAt: string
  comments: FixtureResponse[]
  /** PR 만 */
  reviews: FixtureResponse[]
  isDraft: boolean
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  /** PR 마지막 커밋의 CI */
  ciState: RollupState
  labels: { name: string; color: string }[]
  assignees: string[]
  /** 리뷰 요청: 사용자 login 또는 팀 '@org/slug' */
  reviewRequests: string[]
  /** 이슈 본문에서 언급한 사용자(mentions:@me 검색) */
  mentions?: string[]
  /** 기본 OPEN. 닫힌 이슈는 열린 목록·검색·열린 수에서 빠진다 */
  state?: 'OPEN' | 'CLOSED'
  /** 닫힌 이유(COMPLETED·NOT_PLANNED·DUPLICATE) 또는 다시 열면 REOPENED. 기본 null */
  stateReason?: string | null
  /** 잠긴 이슈: 쓰기 권한이 없으면 코멘트·반응 불가 */
  locked?: boolean
  /** 이슈 상세 본문 HTML. 없으면 제목으로 만든 문단 */
  bodyHTML?: string
  /** 이슈 반응 */
  reactions?: FixtureReactions
  /** 이 이슈를 닫는 PR(closedByPullRequestsReferences) */
  closingPullRequests?: FixtureLinkedPullRequest[]
  /** 타임라인 연결·참조(오래된 → 최신) */
  timeline?: FixtureTimelineEvent[]
  /**
   * 앱에서 POST 로 만든 이슈의 만든 시각(ms). 검색 반영 지연 흉내: 이 값이 있으면 `indexCreatedIssues()`
   * 나 `setSearchIndexDelay(ms)` 로 정한 시간이 지나기 전까지 검색(GraphQL search)에 나오지 않는다.
   */
  createdInAppAt?: number
  /** 검색에 반영됐는가(createdInAppAt 이 있을 때만 본다) */
  searchIndexed?: boolean
}

export interface FixtureCommit {
  oid: string
  message: string
  committedDate: string
  author: string
  ciState: RollupState
}

export interface FixtureRelease {
  nodeId: string
  tagName: string
  name: string
  createdAt: string
  publishedAt: string | null
  isPrerelease: boolean
  isDraft: boolean
}

export interface FixtureRepo {
  id: number
  nodeId: string
  owner: string
  name: string
  description: string | null
  homepageUrl: string | null
  isPrivate: boolean
  isFork: boolean
  isArchived: boolean
  primaryLanguage: { name: string; color: string } | null
  license: { spdxId: string; name: string } | null
  defaultBranch: string
  forkCount: number
  pushedAt: string
  updatedAt: string
  topics: string[]
  viewerPermission: Permission
  /** viewer.repositories(소유·협업·조직 멤버)에 나오는가 */
  viewerAffiliated: boolean
  /** 내가 스타한 시각. null 이면 스타하지 않음 */
  viewerStarredAt: string | null
  languages: { name: string; color: string; size: number }[]
  contributors: { login: string; contributions: number; type: ActorType }[]
  /** 오래된 → 최신 순 (GitHub stargazers 페이지 순서) */
  stargazers: { login: string; starredAt: string }[]
  /** 최신 → 과거 순 */
  commits: FixtureCommit[]
  releases: FixtureRelease[]
  /** 이름이 바뀌기 전 이름들(owner/name). GET /repos/{old} 는 301 */
  previousNames: string[]
  /** 이슈 기능이 켜져 있는가(hasIssuesEnabled·has_issues). 꺼져 있으면 새 이슈 POST 가 410 */
  hasIssuesEnabled: boolean
  /** GET /repos/{o}/{r}/labels */
  labels: FixtureLabel[]
  /** GET /repos/{o}/{r}/assignees (담당자로 지정할 수 있는 사용자) */
  assignableUsers: string[]
}

export interface FixtureLabel {
  name: string
  color: string
  description: string | null
}

/** 커밋 검색(GET /search/commits) 대상. 메시지는 여러 줄일 수 있다(앱은 첫 줄만 쓴다) */
export interface FixtureSearchCommit {
  repoId: number
  oid: string
  message: string
  authoredAt: string
  author: string
}

export interface FixtureContributionDay {
  /** YYYY-MM-DD (UTC 날짜) */
  date: string
  contributionCount: number
  contributionLevel:
    'NONE' | 'FIRST_QUARTILE' | 'SECOND_QUARTILE' | 'THIRD_QUARTILE' | 'FOURTH_QUARTILE'
}

export interface FixtureContributions {
  totalCommitContributions: number
  /** 일요일에 시작하는 주들. 마지막 주는 오늘에서 끝난다 */
  weeks: { contributionDays: FixtureContributionDay[] }[]
}

export interface FixtureNotification {
  id: string
  unread: boolean
  reason: string
  updatedAt: string
  subjectTitle: string
  subjectType: 'PullRequest' | 'Issue' | 'Release' | 'CheckSuite' | 'Discussion' | 'Commit'
  /** API 기준 경로(/repos/o/r/pulls/1). 없으면 null */
  subjectPath: string | null
  repoId: number
}

export interface FixtureState {
  viewer: FixtureActor
  /** 사용자·봇·조직 */
  actors: FixtureActor[]
  /** 내가 속한 팀 ('@org/slug') */
  viewerTeams: string[]
  repos: FixtureRepo[]
  items: FixtureItem[]
  notifications: FixtureNotification[]
  /** GET /user 의 email(공개 이메일). null 이면 공개하지 않음 */
  viewerEmail: string | null
  /** GdeskContributions */
  contributions: FixtureContributions
  /** GET /search/commits 대상 */
  searchCommits: FixtureSearchCommit[]
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** 화면 테스트가 기대값으로 쓰는 고정 값 */
export const FIXTURE = {
  viewer: {
    id: 1001,
    login: 'octo-maintainer',
    name: 'Octo Maintainer',
    /** GET /user 의 공개 이메일 기본값(setUserEmail 로 바꾼다) */
    email: 'octo@maintainer.dev'
  },
  org: { id: 2001, login: 'gdesk-org', team: '@gdesk-org/core' },
  upstreamOrg: { id: 2002, login: 'upstream-org' },
  users: {
    alice: 'alice-dev',
    bob: 'bob-contrib',
    carol: 'carol-oss',
    dave: 'dave-reviewer',
    erin: 'erin-upstream',
    bot: 'dependabot[bot]'
  },
  repos: {
    /** 개인, ADMIN, 상세 지표용(스타 129 중 최근 30일 28, 기여자 25, 커밋 7, 릴리스 4) */
    demo: { id: 101, fullName: 'octo-maintainer/gdesk-demo' },
    /** 개인, 비공개, 열린 항목 없음 */
    dotfiles: { id: 102, fullName: 'octo-maintainer/dotfiles' },
    /** 포크 */
    fork: { id: 103, fullName: 'octo-maintainer/react-fork' },
    /** 보관됨(archived), 열린 이슈 1 */
    archived: { id: 104, fullName: 'octo-maintainer/legacy-tool' },
    /** 조직 저장소, 내 권한 WRITE */
    orgWrite: { id: 201, fullName: 'gdesk-org/gdesk-core' },
    /** 조직 저장소, 내 권한 READ (내 저장소 집합에서 빠진다) */
    orgRead: { id: 202, fullName: 'gdesk-org/website' },
    /** 남의 저장소, 스타함, 내 PR·이슈가 있음 */
    starredOther: { id: 301, fullName: 'upstream-org/awesome-lib' },
    /** 남의 저장소, 스타함 */
    starredOther2: { id: 302, fullName: 'carol-oss/tiny-utils' }
  },
  /** octo-maintainer/gdesk-demo 의 예전 이름 (GET /repos 는 301) */
  renamedFrom: 'octo-maintainer/gdesk-old',
  /** 기본 토큰(classic 처럼 보이는 가짜 값) */
  token: 'ghp_gdesk_e2e_fake_token',
  /** 언제나 401 을 받는 토큰 */
  invalidToken: 'ghp_gdesk_e2e_invalid',
  /** 기기 인증 성공 시 주는 토큰(oauth) */
  deviceToken: 'gho_gdesk_e2e_device_token',
  deviceUserCode: 'GDSK-1234',
  scopes: 'repo, read:org, notifications',
  /** Home 수치: 커밋 기여 수(달력 합과 무관한 고정 값), 연속 기여 일수(오늘 0, 어제부터 5일 1 이상) */
  contributions: { totalCommits: 842, streak: 5 },
  /** mentions:@me 로 나오는 열린 이슈(갱신 최신순) */
  mentionedIssues: [
    'octo-maintainer/gdesk-demo#45',
    'gdesk-org/gdesk-core#7',
    'upstream-org/awesome-lib#91'
  ],
  /** 잠긴 이슈. 저장소 권한 READ 라 코멘트·반응·닫기 불가 */
  lockedIssue: { repoId: 301, fullName: 'upstream-org/awesome-lib', number: 91 },
  /** 이슈 기능이 꺼진 내 저장소(dotfiles) */
  issuesDisabledRepo: { id: 102, fullName: 'octo-maintainer/dotfiles' },
  /** 내 최근 커밋(커밋 검색 author:octo-maintainer, 최신순 5개 첫 줄)과 전체 수 */
  recentCommitMessages: [
    'Merge pull request #38 from alice-dev/quick-search',
    'Add retry with backoff to the sync engine',
    'Fix memory leak in streaming parser',
    'Bump electron to 44.7.2',
    'docs: update README'
  ],
  recentCommitTotal: 7
} as const

/** 새 저장소 기본 라벨(GitHub 기본 라벨 세트) */
const DEFAULT_LABELS: FixtureLabel[] = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  {
    name: 'documentation',
    color: '0075ca',
    description: 'Improvements or additions to documentation'
  },
  { name: 'duplicate', color: 'cfd3d7', description: 'This issue or pull request already exists' },
  { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
  { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
  { name: 'help wanted', color: '008672', description: 'Extra attention is needed' },
  { name: 'invalid', color: 'e4e669', description: "This doesn't seem right" },
  { name: 'question', color: 'd876e3', description: 'Further information is requested' },
  { name: 'wontfix', color: 'ffffff', description: 'This will not be worked on' }
]

/** 1×1 PNG(data: URI). 이슈 본문 이미지용 */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * 101#45 본문. 이미지(data:), 작업 목록 체크박스, 링크, 코드 블록과 함께 **악성 예시**가 들어 있다:
 * `<script>`, `<img onerror>`, `<a href="javascript:">`. 화면은 이것들을 무력화해야 한다.
 */
export const MALICIOUS_BODY_MARKERS = {
  script: 'window.__gdeskXss',
  onerror: 'window.__gdeskXssImg',
  javascriptHref: 'javascript:window.__gdeskXssLink=1'
} as const

const ISSUE_45_BODY = [
  '<p>The app freezes for several seconds when the notification list has more than 500 entries.</p>',
  `<p><img src="${PIXEL_PNG}" alt="freeze screenshot" width="1" height="1"></p>`,
  '<ul class="contains-task-list">',
  '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> Reproduce on macOS</li>',
  '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Reproduce on Linux</li>',
  '</ul>',
  '<p>See <a href="https://docs.github.com/rest/activity/notifications">the notifications API</a> for paging. cc <a class="user-mention" href="https://github.com/octo-maintainer">@octo-maintainer</a></p>',
  '<pre><code class="language-ts">const rows = notifications.slice(0, 500)\nrender(rows)</code></pre>',
  `<script>${MALICIOUS_BODY_MARKERS.script} = 1</script>`,
  `<p><img src="x" onerror="${MALICIOUS_BODY_MARKERS.onerror} = 1" alt="broken"></p>`,
  `<p><a href="${MALICIOUS_BODY_MARKERS.javascriptHref}">click me</a></p>`
].join('\n')

let commitSeq = 0
function sha(seed: number): string {
  return (seed.toString(16).padStart(8, '0') + 'a1b2c3d4e5f60718293a4b5c6d7e8f90').slice(0, 40)
}

export function buildFixtures(now: number = Date.now()): FixtureState {
  commitSeq = 0
  const ago = (ms: number): string => new Date(now - ms).toISOString()
  const V = FIXTURE.viewer.login
  const U = FIXTURE.users

  const actors: FixtureActor[] = [
    { id: FIXTURE.viewer.id, login: V, name: FIXTURE.viewer.name, type: 'User' },
    { id: 3001, login: U.alice, name: 'Alice Kim', type: 'User' },
    { id: 3002, login: U.bob, name: 'Bob Lee', type: 'User' },
    { id: 3003, login: U.carol, name: 'Carol Park', type: 'User' },
    { id: 3004, login: U.dave, name: 'Dave Choi', type: 'User' },
    { id: 3005, login: U.erin, name: 'Erin Jung', type: 'User' },
    { id: 49699333, login: U.bot, name: null, type: 'Bot' },
    { id: FIXTURE.org.id, login: FIXTURE.org.login, name: 'Gdesk Org', type: 'Organization' },
    {
      id: FIXTURE.upstreamOrg.id,
      login: FIXTURE.upstreamOrg.login,
      name: 'Upstream Org',
      type: 'Organization'
    }
  ]
  for (let i = 1; i <= 20; i++) {
    actors.push({ id: 4000 + i, login: `contrib-${pad(i)}`, name: null, type: 'User' })
  }

  const commits = (repoId: number, states: RollupState[], messages: string[]): FixtureCommit[] =>
    states.map((ciState, i) => ({
      oid: sha(repoId * 1000 + ++commitSeq),
      message: messages[i] ?? `Commit ${i + 1}`,
      committedDate: ago((i * 9 + 1) * HOUR),
      author: i % 3 === 1 ? U.alice : V,
      ciState
    }))

  const stars = (recentDaysAgo: number[], older: number, olderFromDay: number) => {
    const list: { login: string; starredAt: string }[] = []
    for (let i = 0; i < older; i++) {
      list.push({
        login: `stargazer-${pad(i + 1, 3)}`,
        starredAt: ago((olderFromDay + i * 3) * DAY)
      })
    }
    recentDaysAgo.forEach((d, i) =>
      list.push({ login: `fan-${pad(i + 1)}`, starredAt: ago(d * DAY + (i % 5) * HOUR) })
    )
    return list.sort((a, b) => a.starredAt.localeCompare(b.starredAt))
  }

  const repo = (patch: Partial<FixtureRepo> & Pick<FixtureRepo, 'id' | 'owner' | 'name'>) => {
    const base: FixtureRepo = {
      id: patch.id,
      nodeId: `R_kgDO${patch.id}`,
      owner: patch.owner,
      name: patch.name,
      description: null,
      homepageUrl: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
      license: { spdxId: 'MIT', name: 'MIT License' },
      defaultBranch: 'main',
      forkCount: 0,
      pushedAt: ago(5 * DAY),
      updatedAt: ago(5 * DAY),
      topics: [],
      viewerPermission: 'ADMIN',
      viewerAffiliated: true,
      viewerStarredAt: null,
      languages: [{ name: 'TypeScript', color: '#3178c6', size: 10_000 }],
      contributors: [{ login: V, contributions: 10, type: 'User' }],
      stargazers: [],
      commits: commits(patch.id, ['SUCCESS', 'SUCCESS', 'SUCCESS'], []),
      releases: [],
      previousNames: [],
      hasIssuesEnabled: true,
      labels: DEFAULT_LABELS.map((l) => ({ ...l })),
      assignableUsers: [
        patch.owner === FIXTURE.org.login || patch.owner === FIXTURE.upstreamOrg.login
          ? V
          : patch.owner
      ]
    }
    return { ...base, ...patch }
  }

  const demoContributors: FixtureRepo['contributors'] = [
    { login: V, contributions: 512, type: 'User' },
    { login: U.alice, contributions: 87, type: 'User' },
    { login: U.bob, contributions: 41, type: 'User' },
    { login: U.bot, contributions: 33, type: 'Bot' },
    { login: U.carol, contributions: 12, type: 'User' }
  ]
  for (let i = 1; i <= 20; i++) {
    demoContributors.push({
      login: `contrib-${pad(i)}`,
      contributions: 11 - (i % 10),
      type: 'User'
    })
  }

  // 최근 30일에 고르게 퍼진 28개 + 35일 이전 100개 = 128
  const recentStarDays = [
    0.1, 0.5, 1, 1.2, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 22, 24, 25,
    27, 28, 29.5
  ]

  const repos: FixtureRepo[] = [
    repo({
      id: 101,
      owner: V,
      name: 'gdesk-demo',
      description: 'A demo project maintained with Gdesk',
      homepageUrl: 'https://gdesk.example.test',
      forkCount: 12,
      pushedAt: ago(1 * HOUR),
      updatedAt: ago(1 * HOUR),
      topics: ['electron', 'github', 'dashboard'],
      viewerStarredAt: ago(200 * DAY),
      languages: [
        { name: 'TypeScript', color: '#3178c6', size: 182_340 },
        { name: 'CSS', color: '#663399', size: 24_310 },
        { name: 'JavaScript', color: '#f1e05a', size: 8_120 },
        { name: 'Shell', color: '#89e051', size: 1_450 }
      ],
      contributors: demoContributors,
      stargazers: stars(recentStarDays, 100, 35),
      commits: commits(
        101,
        ['SUCCESS', 'FAILURE', 'PENDING', null, 'ERROR', 'EXPECTED', 'SUCCESS'],
        [
          'Merge pull request #38 from alice-dev/quick-search',
          'Update notification polling',
          'Bump electron to 44.7.2',
          'docs: update README',
          'Fix flaky cache test',
          'Add stargazer chart',
          'Initial dashboard layout'
        ]
      ),
      releases: [
        {
          nodeId: 'RE_kwDO101_4',
          tagName: 'v1.3.0-beta.1',
          name: 'v1.3.0 beta 1',
          createdAt: ago(2 * DAY),
          publishedAt: ago(2 * DAY),
          isPrerelease: true,
          isDraft: false
        },
        {
          nodeId: 'RE_kwDO101_3',
          tagName: 'v1.2.0',
          name: 'v1.2.0',
          createdAt: ago(10 * DAY),
          publishedAt: ago(10 * DAY),
          isPrerelease: false,
          isDraft: false
        },
        {
          nodeId: 'RE_kwDO101_2',
          tagName: 'v1.1.0',
          name: 'v1.1.0',
          createdAt: ago(40 * DAY),
          publishedAt: ago(40 * DAY),
          isPrerelease: false,
          isDraft: false
        },
        {
          nodeId: 'RE_kwDO101_1',
          tagName: 'v1.0.0',
          name: 'First stable release',
          createdAt: ago(90 * DAY),
          publishedAt: ago(90 * DAY),
          isPrerelease: false,
          isDraft: false
        }
      ],
      previousNames: [FIXTURE.renamedFrom],
      labels: [
        ...DEFAULT_LABELS.map((l) => ({ ...l })),
        {
          name: 'dependencies',
          color: '0366d6',
          description: 'Pull requests that update a dependency file'
        },
        { name: 'meta', color: 'fbca04', description: null }
      ],
      assignableUsers: [V, U.alice, U.bob]
    }),
    repo({
      id: 102,
      owner: V,
      name: 'dotfiles',
      description: 'My dotfiles',
      isPrivate: true,
      primaryLanguage: { name: 'Shell', color: '#89e051' },
      languages: [{ name: 'Shell', color: '#89e051', size: 4_200 }],
      license: null,
      pushedAt: ago(3 * DAY),
      updatedAt: ago(3 * DAY),
      stargazers: [],
      // 이슈 기능이 꺼진 내 저장소(새 이슈 불가)
      hasIssuesEnabled: false
    }),
    repo({
      id: 103,
      owner: V,
      name: 'react-fork',
      description: 'Fork of a UI library for experiments',
      isFork: true,
      primaryLanguage: { name: 'JavaScript', color: '#f1e05a' },
      languages: [{ name: 'JavaScript', color: '#f1e05a', size: 90_000 }],
      pushedAt: ago(20 * DAY),
      updatedAt: ago(20 * DAY),
      stargazers: stars([], 1, 60)
    }),
    repo({
      id: 104,
      owner: V,
      name: 'legacy-tool',
      description: 'Old CLI tool (archived)',
      isArchived: true,
      primaryLanguage: { name: 'Go', color: '#00ADD8' },
      languages: [{ name: 'Go', color: '#00ADD8', size: 30_500 }],
      pushedAt: ago(400 * DAY),
      updatedAt: ago(400 * DAY),
      stargazers: stars([], 7, 100)
    }),
    repo({
      id: 201,
      owner: FIXTURE.org.login,
      name: 'gdesk-core',
      description: 'Core library of the Gdesk organization',
      viewerPermission: 'WRITE',
      forkCount: 4,
      pushedAt: ago(2 * HOUR),
      updatedAt: ago(2 * HOUR),
      topics: ['library'],
      languages: [
        { name: 'TypeScript', color: '#3178c6', size: 64_000 },
        { name: 'Rust', color: '#dea584', size: 12_000 }
      ],
      contributors: [
        { login: U.dave, contributions: 140, type: 'User' },
        { login: V, contributions: 95, type: 'User' },
        { login: U.alice, contributions: 9, type: 'User' }
      ],
      stargazers: stars([1, 6, 15], 20, 32),
      assignableUsers: [V, U.dave, U.alice]
    }),
    repo({
      id: 202,
      owner: FIXTURE.org.login,
      name: 'website',
      description: 'Organization website',
      viewerPermission: 'READ',
      primaryLanguage: { name: 'HTML', color: '#e34c26' },
      languages: [{ name: 'HTML', color: '#e34c26', size: 5_000 }],
      pushedAt: ago(30 * DAY),
      updatedAt: ago(30 * DAY),
      stargazers: stars([], 2, 50),
      assignableUsers: [U.dave, V]
    }),
    repo({
      id: 301,
      owner: FIXTURE.upstreamOrg.login,
      name: 'awesome-lib',
      description: 'An awesome library I contribute to',
      viewerPermission: 'READ',
      viewerAffiliated: false,
      viewerStarredAt: ago(20 * DAY),
      forkCount: 210,
      pushedAt: ago(4 * HOUR),
      updatedAt: ago(4 * HOUR),
      topics: ['parser', 'streaming'],
      license: { spdxId: 'Apache-2.0', name: 'Apache License 2.0' },
      contributors: [
        { login: U.erin, contributions: 900, type: 'User' },
        { login: V, contributions: 14, type: 'User' }
      ],
      stargazers: stars([0.3, 2, 9, 21], 250, 32),
      labels: [
        ...DEFAULT_LABELS.map((l) => ({ ...l })),
        { name: 'docs', color: '0075ca', description: null }
      ],
      assignableUsers: [U.erin]
    }),
    repo({
      id: 302,
      owner: U.carol,
      name: 'tiny-utils',
      description: 'Tiny utility functions',
      viewerPermission: 'READ',
      viewerAffiliated: false,
      viewerStarredAt: ago(5 * DAY),
      primaryLanguage: { name: 'JavaScript', color: '#f1e05a' },
      languages: [{ name: 'JavaScript', color: '#f1e05a', size: 3_000 }],
      contributors: [{ login: U.carol, contributions: 50, type: 'User' }],
      pushedAt: ago(9 * DAY),
      updatedAt: ago(9 * DAY),
      stargazers: stars([5], 30, 40)
    })
  ]
  // 내가 스타한 저장소의 스타 목록에는 나도 들어 있다
  for (const r of repos) {
    if (r.viewerStarredAt) {
      r.stargazers.push({ login: V, starredAt: r.viewerStarredAt })
      r.stargazers.sort((a, b) => a.starredAt.localeCompare(b.starredAt))
    }
  }

  const resp = (login: string, authorAssociation: string, hoursAgo: number): FixtureResponse => ({
    login,
    authorAssociation,
    createdAt: ago(hoursAgo * HOUR)
  })

  const item = (
    patch: Partial<FixtureItem> &
      Pick<FixtureItem, 'kind' | 'repoId' | 'number' | 'title' | 'author' | 'authorAssociation'>,
    createdHoursAgo: number,
    updatedHoursAgo: number
  ): FixtureItem => ({
    nodeId: `${patch.kind === 'PullRequest' ? 'PR' : 'I'}_kwDO${patch.repoId}_${patch.number}`,
    createdAt: ago(createdHoursAgo * HOUR),
    updatedAt: ago(updatedHoursAgo * HOUR),
    comments: [],
    reviews: [],
    isDraft: false,
    reviewDecision: null,
    ciState: patch.kind === 'PullRequest' ? 'SUCCESS' : null,
    labels: [],
    assignees: [],
    reviewRequests: [],
    ...patch
  })

  const items: FixtureItem[] = [
    // ── octo-maintainer/gdesk-demo (101): 들어온 PR 4, 이슈 3 ──
    item(
      {
        kind: 'PullRequest',
        repoId: 101,
        number: 42,
        title: 'Add keyboard shortcuts for quick search',
        author: U.alice,
        authorAssociation: 'CONTRIBUTOR'
      },
      30,
      2
    ),
    item(
      {
        kind: 'PullRequest',
        repoId: 101,
        number: 41,
        title: 'Bump vite from 8.3.3 to 8.3.4',
        author: U.bot,
        authorAssociation: 'NONE',
        labels: [{ name: 'dependencies', color: '0366d6' }]
      },
      48,
      20
    ),
    item(
      {
        kind: 'PullRequest',
        repoId: 101,
        number: 40,
        title: 'Fix crash when cache is empty',
        author: U.bob,
        authorAssociation: 'CONTRIBUTOR',
        comments: [resp(U.bob, 'CONTRIBUTOR', 70), resp(V, 'OWNER', 60)],
        reviews: [resp(V, 'OWNER', 59)],
        reviewDecision: 'CHANGES_REQUESTED',
        ciState: 'FAILURE'
      },
      72,
      8
    ),
    item(
      {
        kind: 'PullRequest',
        repoId: 101,
        number: 39,
        title: 'WIP: Korean translations for settings',
        author: U.carol,
        authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
        isDraft: true,
        ciState: 'PENDING'
      },
      96,
      26
    ),
    item(
      {
        kind: 'Issue',
        repoId: 101,
        number: 45,
        title: 'App freezes on large notification lists',
        author: U.bob,
        authorAssociation: 'NONE',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        // 상세용 코멘트 셋 모두 쓰기 권한 없는 사람 → 여전히 응답 없는 기여
        comments: [
          {
            ...resp(U.alice, 'CONTRIBUTOR', 10),
            bodyHTML:
              '<p>I can reproduce this with 800 notifications. Profiling shows the list re-renders on every poll.</p>',
            reactions: { THUMBS_UP: [U.bob, V], HEART: [U.carol] }
          },
          {
            ...resp(U.bob, 'NONE', 6),
            bodyHTML:
              '<p>Workaround: mark all as done.</p><pre><code>gdesk --clear-notifications</code></pre>',
            reactions: { LAUGH: [U.alice] }
          },
          {
            ...resp(U.carol, 'NONE', 3),
            bodyHTML:
              '<p>Same here on Linux. <img src="x" onerror="window.__gdeskXssComment = 1" alt="oops"></p>',
            reactions: {}
          }
        ],
        assignees: [U.alice],
        mentions: [V],
        bodyHTML: ISSUE_45_BODY,
        reactions: { THUMBS_UP: [U.alice, U.carol, U.dave], EYES: [V], HEART: [U.bob] },
        closingPullRequests: [
          {
            repo: FIXTURE.repos.demo.fullName,
            number: 42,
            title: 'Add keyboard shortcuts for quick search',
            state: 'OPEN'
          }
        ],
        timeline: [
          {
            type: 'CrossReferencedEvent',
            pr: {
              repo: FIXTURE.repos.demo.fullName,
              number: 38,
              title: 'Virtualize the notification list',
              state: 'MERGED'
            }
          },
          {
            type: 'CrossReferencedEvent',
            pr: {
              repo: FIXTURE.repos.demo.fullName,
              number: 37,
              title: 'Batch notification rendering (abandoned)',
              state: 'CLOSED'
            }
          },
          {
            type: 'ReferencedEvent',
            repo: FIXTURE.repos.demo.fullName,
            oid: 'f45a1e0c0ffee45a1e0c0ffee45a1e0c0ffee45a',
            message: 'Throttle notification list updates (refs #45)',
            committedDate: ago(8 * HOUR),
            author: U.alice
          },
          {
            type: 'ReferencedEvent',
            repo: FIXTURE.repos.demo.fullName,
            oid: 'f45b2e0c0ffee45b2e0c0ffee45b2e0c0ffee45b',
            message: 'Add a benchmark for 1000 notifications\n\nRefs #45',
            committedDate: ago(5 * HOUR),
            author: V
          }
        ]
      },
      12,
      3
    ),
    item(
      {
        kind: 'Issue',
        repoId: 101,
        number: 44,
        title: 'Support GitHub Enterprise Server',
        author: U.carol,
        authorAssociation: 'CONTRIBUTOR',
        labels: [{ name: 'enhancement', color: 'a2eeef' }],
        comments: [resp(V, 'OWNER', 40)],
        assignees: [V, U.alice]
      },
      100,
      40
    ),
    item(
      {
        kind: 'Issue',
        repoId: 101,
        number: 43,
        title: 'Roadmap for v2',
        author: V,
        authorAssociation: 'OWNER',
        labels: [{ name: 'meta', color: 'fbca04' }]
      },
      200,
      50
    ),
    // ── octo-maintainer/legacy-tool (104, 보관됨): 이슈 1 ──
    item(
      {
        kind: 'Issue',
        repoId: 104,
        number: 11,
        title: 'Does this still work on Go 1.24?',
        author: U.bob,
        authorAssociation: 'NONE'
      },
      24 * 60,
      24 * 60
    ),
    // ── gdesk-org/gdesk-core (201): PR 2(리뷰 요청: 직접·팀), 이슈 2 ──
    item(
      {
        kind: 'PullRequest',
        repoId: 201,
        number: 13,
        title: 'Add rate limit banner',
        author: U.alice,
        authorAssociation: 'CONTRIBUTOR',
        reviewRequests: [V],
        reviewDecision: 'REVIEW_REQUIRED'
      },
      10,
      1
    ),
    item(
      {
        kind: 'PullRequest',
        repoId: 201,
        number: 12,
        title: 'Bump cache schema version',
        author: U.dave,
        authorAssociation: 'MEMBER',
        reviewRequests: [FIXTURE.org.team],
        reviewDecision: 'REVIEW_REQUIRED'
      },
      30,
      5
    ),
    item(
      {
        kind: 'Issue',
        repoId: 201,
        number: 8,
        title: 'Document the IPC contract',
        author: U.alice,
        authorAssociation: 'CONTRIBUTOR',
        comments: [resp(U.dave, 'MEMBER', 70)],
        assignees: [V, U.dave],
        labels: [{ name: 'documentation', color: '0075ca' }]
      },
      90,
      70
    ),
    item(
      {
        kind: 'Issue',
        repoId: 201,
        number: 7,
        title: 'Crash on Linux without a keyring',
        author: U.bob,
        authorAssociation: 'NONE',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        assignees: [U.alice, U.dave],
        mentions: [V],
        bodyHTML: [
          '<p>Starting the app on a Linux machine without a Secret Service provider crashes immediately.</p>',
          '<pre><code>Error: Cannot autolaunch D-Bus without X11 $DISPLAY</code></pre>',
          '<p>Steps: <code>docker run --rm -it ubuntu:24.04</code>, install, launch. /cc @octo-maintainer</p>'
        ].join('\n'),
        reactions: { THUMBS_UP: [U.alice], CONFUSED: [U.carol] },
        timeline: [
          {
            type: 'ConnectedEvent',
            pr: {
              repo: FIXTURE.repos.orgWrite.fullName,
              number: 14,
              title: 'Fall back to an encrypted file when no keyring',
              state: 'OPEN'
            }
          },
          {
            type: 'ConnectedEvent',
            pr: {
              repo: FIXTURE.repos.orgWrite.fullName,
              number: 9,
              title: 'Detect keyring at startup',
              state: 'CLOSED'
            }
          },
          {
            type: 'DisconnectedEvent',
            pr: {
              repo: FIXTURE.repos.orgWrite.fullName,
              number: 9,
              title: 'Detect keyring at startup',
              state: 'CLOSED'
            }
          }
        ]
      },
      14,
      14
    ),
    // ── gdesk-org/website (202, READ): 이슈 1 ──
    item(
      {
        kind: 'Issue',
        repoId: 202,
        number: 2,
        title: 'Broken link on the about page',
        author: U.carol,
        authorAssociation: 'NONE'
      },
      300,
      300
    ),
    // ── upstream-org/awesome-lib (301): 내 PR 2(하나는 CI 실패), 리뷰 요청 PR 1, 내 이슈 1, 남의 이슈 1 ──
    item(
      {
        kind: 'PullRequest',
        repoId: 301,
        number: 77,
        title: 'Fix memory leak in streaming parser',
        author: V,
        authorAssociation: 'CONTRIBUTOR',
        comments: [resp(U.erin, 'MEMBER', 20)],
        reviewDecision: 'REVIEW_REQUIRED',
        ciState: 'FAILURE'
      },
      50,
      6
    ),
    item(
      {
        kind: 'PullRequest',
        repoId: 301,
        number: 78,
        title: 'Add TypeScript type definitions',
        author: V,
        authorAssociation: 'CONTRIBUTOR',
        reviews: [resp(U.erin, 'MEMBER', 10)],
        reviewDecision: 'APPROVED',
        ciState: 'SUCCESS'
      },
      40,
      10
    ),
    item(
      {
        kind: 'PullRequest',
        repoId: 301,
        number: 80,
        title: 'Prepare the 3.0 release',
        author: U.erin,
        authorAssociation: 'MEMBER',
        reviewRequests: [V],
        reviewDecision: 'REVIEW_REQUIRED',
        ciState: 'PENDING'
      },
      20,
      4
    ),
    item(
      {
        kind: 'Issue',
        repoId: 301,
        number: 90,
        title: 'Docs: clarify the streaming API',
        author: V,
        authorAssociation: 'CONTRIBUTOR',
        comments: [resp(U.erin, 'MEMBER', 30)],
        labels: [{ name: 'docs', color: '0075ca' }],
        assignees: [U.erin]
      },
      120,
      30
    ),
    item(
      {
        kind: 'Issue',
        repoId: 301,
        number: 91,
        title: 'Support async iterators',
        author: U.alice,
        authorAssociation: 'NONE',
        // 잠긴 이슈(내 권한 READ → 코멘트·반응 불가)
        locked: true,
        mentions: [V],
        comments: [
          {
            ...resp(U.alice, 'NONE', 60),
            bodyHTML: '<p>@octo-maintainer would you review a PR for this?</p>'
          }
        ],
        reactions: { THUMBS_UP: [U.alice, U.bob] }
      },
      60,
      60
    )
  ]

  const n = (
    id: string,
    unread: boolean,
    reason: string,
    hoursAgo: number,
    repoId: number,
    subjectType: FixtureNotification['subjectType'],
    subjectTitle: string,
    subjectPath: string | null
  ): FixtureNotification => ({
    id,
    unread,
    reason,
    updatedAt: ago(hoursAgo * HOUR),
    subjectTitle,
    subjectType,
    subjectPath,
    repoId
  })
  const notifications: FixtureNotification[] = [
    n(
      '9001',
      true,
      'review_requested',
      1,
      201,
      'PullRequest',
      'Add rate limit banner',
      '/repos/gdesk-org/gdesk-core/pulls/13'
    ),
    n(
      '9002',
      true,
      'mention',
      3,
      101,
      'Issue',
      'App freezes on large notification lists',
      '/repos/octo-maintainer/gdesk-demo/issues/45'
    ),
    n(
      '9003',
      true,
      'team_mention',
      5,
      201,
      'PullRequest',
      'Bump cache schema version',
      '/repos/gdesk-org/gdesk-core/pulls/12'
    ),
    n('9004', true, 'ci_activity', 6, 101, 'CheckSuite', 'CI workflow run failed for main', null),
    n(
      '9005',
      true,
      'comment',
      8,
      101,
      'PullRequest',
      'Fix crash when cache is empty',
      '/repos/octo-maintainer/gdesk-demo/pulls/40'
    ),
    n(
      '9006',
      true,
      'subscribed',
      24,
      301,
      'Release',
      'v3.0.0-rc.1',
      '/repos/upstream-org/awesome-lib/releases/5001'
    ),
    n(
      '9007',
      false,
      'author',
      48,
      301,
      'PullRequest',
      'Fix memory leak in streaming parser',
      '/repos/upstream-org/awesome-lib/pulls/77'
    ),
    n(
      '9008',
      false,
      'assign',
      72,
      201,
      'Issue',
      'Document the IPC contract',
      '/repos/gdesk-org/gdesk-core/issues/8'
    ),
    n(
      '9009',
      false,
      'state_change',
      96,
      301,
      'Issue',
      'Docs: clarify the streaming API',
      '/repos/upstream-org/awesome-lib/issues/90'
    )
  ]

  // 이슈 코멘트 노드 ID 를 미리 정해 둔다(반응·코멘트 mutation 이 이 ID 로 찾는다)
  for (const it of items) {
    if (it.kind !== 'Issue') continue
    it.comments.forEach((c, i) => {
      c.id ??= commentNodeId(it, i)
    })
  }

  // 커밋 검색: gdesk-demo 커밋 전부 + 다른 저장소의 내 커밋 둘(작성 시각이 겹치지 않게)
  const demo = repos[0] as FixtureRepo
  const searchCommits: FixtureSearchCommit[] = [
    ...demo.commits.map((c) => ({
      repoId: demo.id,
      oid: c.oid,
      message: c.message,
      authoredAt: c.committedDate,
      author: c.author
    })),
    {
      repoId: 201,
      oid: sha(201_900_001),
      message:
        'Add retry with backoff to the sync engine\n\nRetries transient 5xx errors up to three times.',
      authoredAt: ago(5 * HOUR),
      author: V
    },
    {
      repoId: 301,
      oid: sha(301_900_001),
      message: 'Fix memory leak in streaming parser\n\nCloses #76',
      authoredAt: ago(7 * HOUR),
      author: V
    }
  ]

  return {
    viewer: actors[0] as FixtureActor,
    actors,
    viewerTeams: [FIXTURE.org.team],
    repos,
    items,
    notifications,
    viewerEmail: FIXTURE.viewer.email,
    contributions: buildContributions(now),
    searchCommits
  }
}

/** 이슈 코멘트의 기본 노드 ID */
export function commentNodeId(item: Pick<FixtureItem, 'repoId' | 'number'>, index: number): string {
  return `IC_kwDO${item.repoId}_${item.number}_${index + 1}`
}

/** 최근 5일(어제~5일 전)의 기여 수. 오늘은 0, 6일 전도 0 → 연속 5일 */
const RECENT_CONTRIBUTIONS = [4, 9, 2, 6, 1]

function contributionLevel(count: number): FixtureContributionDay['contributionLevel'] {
  if (count <= 0) return 'NONE'
  if (count <= 2) return 'FIRST_QUARTILE'
  if (count <= 5) return 'SECOND_QUARTILE'
  if (count <= 8) return 'THIRD_QUARTILE'
  return 'FOURTH_QUARTILE'
}

/**
 * 기여 달력(최근 1년). 날짜는 UTC 기준이다: 오늘(now 의 UTC 날짜)에서 끝나고, 364일 전이 든 주의
 * 일요일에서 시작한다(53주, 마지막 주는 짧을 수 있다). 수는 날짜가 아니라 "며칠 전"으로 정해지므로
 * 언제 돌려도 같다: 오늘 0, 어제부터 5일은 1 이상(연속 5일), 6일 전 0, 그 앞은 0~9 가 섞인다(다섯 수준 모두).
 */
export function buildContributions(now: number): FixtureContributions {
  const today = new Date(now)
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const firstDay = todayUtc - 364 * DAY
  const start = firstDay - new Date(firstDay).getUTCDay() * DAY
  const weeks: FixtureContributions['weeks'] = []
  for (let t = start; t <= todayUtc; t += DAY) {
    const daysAgo = Math.round((todayUtc - t) / DAY)
    let count: number
    if (daysAgo === 0 || daysAgo === 6) count = 0
    else if (daysAgo <= 5) count = RECENT_CONTRIBUTIONS[daysAgo - 1] ?? 1
    else {
      const v = (daysAgo * 37 + ((daysAgo * daysAgo) % 11)) % 13
      count = v < 4 ? 0 : v - 3
    }
    if (new Date(t).getUTCDay() === 0 || weeks.length === 0) weeks.push({ contributionDays: [] })
    ;(weeks[weeks.length - 1] as FixtureContributions['weeks'][number]).contributionDays.push({
      date: new Date(t).toISOString().slice(0, 10),
      contributionCount: count,
      contributionLevel: contributionLevel(count)
    })
  }
  return { totalCommitContributions: FIXTURE.contributions.totalCommits, weeks }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 저장소 전체 이름 */
export function fullName(repo: Pick<FixtureRepo, 'owner' | 'name'>): string {
  return `${repo.owner}/${repo.name}`
}

/** 아바타: 실제 GitHub 에 접속하지 않도록 data: URI (화면 CSP 는 data: 이미지를 허용한다) */
export function avatarUrl(login: string): string {
  let hash = 0
  for (const ch of login) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const color = (hash & 0xffffff).toString(16).padStart(6, '0')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#${color}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
