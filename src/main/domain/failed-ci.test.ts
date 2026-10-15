import { describe, expect, it } from 'vitest'
import type { PullRequestRow } from '@shared/domain/pr'
import type { CiStatus } from '@shared/domain/ci'
import { composeFailedCi, type TrackedRepoHead } from './failed-ci'

function head(repoId: number, ci: CiStatus | null): TrackedRepoHead {
  return {
    repoId,
    repoFullName: `o/r${repoId}`,
    defaultBranch: 'main',
    latestCommit:
      ci === null
        ? null
        : {
            sha: `sha${repoId}`,
            message: 'm',
            url: `https://github.com/o/r${repoId}/commit/sha${repoId}`,
            committedAt: '2026-10-01T00:00:00Z',
            ciStatus: ci
          }
  }
}

function pr(id: string, ci: CiStatus, updatedAt = '2026-10-01T00:00:00Z'): PullRequestRow {
  return {
    id,
    repoId: 1,
    repoFullName: 'o/r1',
    number: 1,
    title: id,
    url: `https://github.com/o/r1/pull/${id}`,
    author: { login: 'me', avatarUrl: null, isBot: false },
    state: 'open',
    reviewStatus: 'none',
    ciStatus: ci,
    commentCount: 0,
    createdAt: updatedAt,
    updatedAt
  }
}

describe('composeFailedCi (spec §4.2)', () => {
  it.each([
    ['추적 저장소 실패', [1], [head(1, 'failing')], [1]],
    ['추적 저장소 통과', [1], [head(1, 'passing')], []],
    ['추적 저장소 진행 중', [1], [head(1, 'pending')], []],
    ['추적 저장소 CI 없음', [1], [head(1, 'none')], []],
    ['커밋 정보 없음', [1], [head(1, null)], []],
    ['추적하지 않는 저장소의 실패는 제외', [2], [head(1, 'failing'), head(2, 'passing')], []],
    ['상세 정보가 없는 추적 저장소', [3], [head(1, 'failing')], []],
    [
      '여러 추적 저장소: 추적 순서 유지·중복 제거',
      [2, 1, 2],
      [head(1, 'failing'), head(2, 'failing')],
      [2, 1]
    ]
  ] as const)('(a) %s', (_name, tracked, heads, expectedIds) => {
    const card = composeFailedCi(tracked, heads, [])
    expect(card.repos.map((r) => r.repoId)).toEqual(expectedIds)
    expect(card.pullRequests).toEqual([])
  })

  it('(b) 내가 올린 열린 PR 중 최신 커밋 CI 실패만, 최근 갱신 순', () => {
    const card = composeFailedCi(
      [],
      [],
      [
        pr('a', 'failing', '2026-10-01T00:00:00Z'),
        pr('b', 'passing'),
        pr('c', 'pending'),
        pr('d', 'none'),
        pr('e', 'failing', '2026-10-03T00:00:00Z')
      ]
    )
    expect(card.repos).toEqual([])
    expect(card.pullRequests.map((p) => p.id)).toEqual(['e', 'a'])
  })

  it('(a)+(b) 를 함께 낸다', () => {
    const card = composeFailedCi([1], [head(1, 'failing')], [pr('x', 'failing')])
    expect(card.repos).toHaveLength(1)
    expect(card.repos[0]).toMatchObject({ repoId: 1, sha: 'sha1', ciStatus: 'failing' })
    expect(card.pullRequests.map((p) => p.id)).toEqual(['x'])
  })
})
