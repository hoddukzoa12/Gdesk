import type { ActorSummary } from './actor'

export interface IssueLabel {
  name: string
  /** 6자리 16진수(# 없음) */
  color: string | null
}

/** 이슈 목록 행 (spec §4.6). PR 은 섞지 않는다 */
export interface IssueRow {
  /** GraphQL 노드 ID */
  id: string
  repoId: number
  repoFullName: string
  number: number
  title: string
  url: string
  author: ActorSummary
  labels: IssueLabel[]
  commentCount: number
  createdAt: string
  updatedAt: string
}
