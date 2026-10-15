import { describe, expect, it } from 'vitest'
import { collectNotifications } from './notifications'
import { TEST_BASE, fakeGitHub, json, link } from './test-server'

function thread(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    unread: true,
    reason: 'review_requested',
    updated_at: '2026-10-10T00:00:00Z',
    subject: {
      title: `Thread ${id}`,
      url: `${TEST_BASE}/repos/acme/widget/pulls/${id}`,
      type: 'PullRequest'
    },
    repository: { id: 42, full_name: 'acme/widget', html_url: 'https://github.com/acme/widget' },
    ...patch
  }
}

describe('collectNotifications', () => {
  it('200: 모든 페이지를 모으고 etag·last-modified·폴링 간격을 돌려준다', async () => {
    const { client, calls } = fakeGitHub({
      rest: {
        'GET /notifications': (url) =>
          url.searchParams.get('page') === '2'
            ? json([
                thread('2', {
                  unread: false,
                  subject: { title: 'x', url: null, type: 'Discussion' }
                })
              ])
            : json([thread('1')], 200, {
                etag: 'W/"abc"',
                'last-modified': 'Thu, 15 Oct 2026 00:00:00 GMT',
                'x-poll-interval': '60',
                link: link({ next: `${TEST_BASE}/notifications?all=true&per_page=50&page=2` })
              })
      }
    })
    const result = await collectNotifications({ client })
    expect(calls[0]?.url).toContain('all=true')
    expect(result).toMatchObject({
      notModified: false,
      etag: 'W/"abc"',
      lastModified: 'Thu, 15 Oct 2026 00:00:00 GMT',
      pollInterval: 60,
      complete: true
    })
    if (result.notModified) throw new Error('unexpected')
    expect(result.notifications).toEqual([
      {
        threadId: '1',
        state: 'unread',
        reason: 'review_requested',
        subjectTitle: 'Thread 1',
        subjectType: 'PullRequest',
        subjectApiUrl: `${TEST_BASE}/repos/acme/widget/pulls/1`,
        url: 'https://github.com/acme/widget/pull/1',
        repoId: 42,
        repoFullName: 'acme/widget',
        updatedAt: '2026-10-10T00:00:00Z'
      },
      expect.objectContaining({
        threadId: '2',
        state: 'read',
        url: 'https://github.com/acme/widget/discussions'
      })
    ])
  })

  it('304: 조건부 요청 헤더를 보내고 변경 없음을 돌려준다', async () => {
    const { client, calls } = fakeGitHub({
      rest: {
        'GET /notifications': () => json(null, 304, { 'x-poll-interval': '120' })
      }
    })
    const result = await collectNotifications({
      client,
      etag: 'W/"abc"',
      lastModified: 'Thu, 15 Oct 2026 00:00:00 GMT'
    })
    expect(calls[0]?.headers.get('if-none-match')).toBe('W/"abc"')
    expect(calls[0]?.headers.get('if-modified-since')).toBe('Thu, 15 Oct 2026 00:00:00 GMT')
    expect(result).toEqual({
      notModified: true,
      etag: 'W/"abc"',
      lastModified: 'Thu, 15 Oct 2026 00:00:00 GMT',
      pollInterval: 120
    })
  })

  it('maxPages 를 넘으면 멈추고 불완전으로 표시한다', async () => {
    const { client, calls } = fakeGitHub({
      rest: {
        'GET /notifications': (url) =>
          json([thread(url.searchParams.get('page') ?? '1')], 200, {
            link: link({
              next: `${TEST_BASE}/notifications?page=${Number(url.searchParams.get('page') ?? 1) + 1}`
            })
          })
      }
    })
    const result = await collectNotifications({ client, maxPages: 2 })
    expect(calls).toHaveLength(2)
    expect(result).toMatchObject({ notModified: false, complete: false })
  })
})
