import { describe, expect, it } from 'vitest'
import { composeHomeStats, contributionStreak } from './home-activity'

function days(counts: number[], start = '2026-10-01'): { date: string; count: number }[] {
  const base = Date.parse(`${start}T00:00:00Z`)
  return counts.map((count, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    count
  }))
}

describe('contributionStreak (마지막 칸 = 오늘)', () => {
  it.each([
    ['오늘 > 0 이면 오늘부터 거꾸로 센다', [0, 1, 2, 3], 3],
    ['오늘 0, 어제 > 0 이면 어제부터 센다', [0, 4, 1, 0], 2],
    ['오늘·어제 모두 0 이면 0', [5, 5, 0, 0], 0],
    ['모든 날이 1 이상이면 전체 길이', [1, 1, 1], 3],
    ['빈 달력은 0', [], 0],
    ['하루뿐이고 0 이면 0', [0], 0],
    ['하루뿐이고 1 이상이면 1', [2], 1]
  ])('%s', (_name, counts, expected) => {
    expect(contributionStreak(days(counts))).toBe(expected)
  })

  it('연도 경계를 넘는 연속도 끊기지 않는다', () => {
    const calendar = days([0, 1, 1, 1, 1, 1], '2025-12-28')
    expect(calendar.map((d) => d.date)).toEqual([
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02'
    ])
    expect(contributionStreak(calendar)).toBe(5)
    // 오늘(1/2)이 0 이어도 어제부터 이어진 연속은 남는다
    expect(contributionStreak(days([0, 1, 1, 1, 1, 0], '2025-12-28'))).toBe(4)
  })
})

describe('composeHomeStats', () => {
  it('받은 값을 그대로 담고 연속 기여는 달력에서 센다', () => {
    expect(
      composeHomeStats({
        contributions: { totalCommitContributions: 321, days: days([1, 0, 2, 3]) },
        repositoryCount: 7,
        openPullRequestTotal: 4
      })
    ).toEqual({ commits: 321, repositories: 7, openPullRequests: 4, streak: 2 })
  })

  it('아직 받지 않은 값은 null', () => {
    expect(
      composeHomeStats({ contributions: null, repositoryCount: null, openPullRequestTotal: null })
    ).toEqual({ commits: null, repositories: null, openPullRequests: null, streak: null })
  })

  it('0 은 null 이 아니다', () => {
    expect(
      composeHomeStats({
        contributions: { totalCommitContributions: 0, days: days([0, 0]) },
        repositoryCount: 0,
        openPullRequestTotal: 0
      })
    ).toEqual({ commits: 0, repositories: 0, openPullRequests: 0, streak: 0 })
  })
})
