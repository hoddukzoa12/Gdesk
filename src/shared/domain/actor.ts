/** PR·이슈·커밋 작성자 요약. 지워진 계정은 login 'ghost' 로 둔다. */
export interface ActorSummary {
  login: string
  avatarUrl: string | null
  /** GitHub App 봇 계정(GraphQL __typename 'Bot' 또는 login 이 '[bot]' 으로 끝남) */
  isBot: boolean
}
