import type { IssueDetailRecord } from '../../cache/types'
import type { OrgRestriction } from '../client'
import { resolveClient } from './common'
import type { CollectorOptions } from './common'
import { mapIssueDetail } from './map'
import { ISSUE_DETAIL_QUERY, LIST_LIMITS, OPERATIONS } from './queries'
import type { RawIssueDetailRepository } from './raw'

/** 이슈 상세 수집 (spec §6.2). 받아서 바꾸기만 한다. 캐시 반영은 refresh.ts 의 refreshIssueDetail */

export interface IssueDetailTarget {
  repoId: number
  /** `owner/name`(캐시에서 찾은 이름) */
  fullName: string
  number: number
}

export interface IssueDetailOptions extends CollectorOptions {
  /** 오래된 것부터 받을 코멘트 수. 기본 LIST_LIMITS.issueDetailComments(100), 최대 100 */
  commentCount?: number
}

export type IssueDetailOutcome =
  | { status: 'ok'; detail: IssueDetailRecord; orgRestrictions: OrgRestriction[] }
  /** 저장소·이슈가 비어 왔다(삭제, 권한 없음, PR 번호) */
  | { status: 'not_found'; orgRestrictions: OrgRestriction[] }

function clamp(value: number | undefined, fallback: number): number {
  return Math.min(100, Math.max(1, Math.floor(value ?? fallback)))
}

/**
 * GdeskIssueDetail 한 번(GraphQL 한도). 네트워크·한도·세션 오류와 데이터 없는 GraphQL 실패는 던진다.
 * 저장소나 이슈가 null 로 오면(GitHub 는 NOT_FOUND 오류와 함께 준다) not_found.
 */
export async function collectIssueDetail(
  target: IssueDetailTarget,
  options: IssueDetailOptions = {}
): Promise<IssueDetailOutcome> {
  const client = resolveClient(options)
  const [owner = '', name = ''] = target.fullName.split('/')
  const res = await client.graphql<{ repository?: RawIssueDetailRepository | null }>(
    ISSUE_DETAIL_QUERY,
    {
      owner,
      name,
      number: target.number,
      commentCount: clamp(options.commentCount, LIST_LIMITS.issueDetailComments),
      labelCount: LIST_LIMITS.issueDetailLabels,
      closingCount: LIST_LIMITS.issueDetailClosingPullRequests,
      timelineCount: LIST_LIMITS.issueDetailTimelineItems
    },
    { operationName: OPERATIONS.issueDetail, signal: options.signal }
  )
  const detail = mapIssueDetail(res.data.repository, target)
  return detail === null
    ? { status: 'not_found', orgRestrictions: res.orgRestrictions }
    : { status: 'ok', detail, orgRestrictions: res.orgRestrictions }
}
