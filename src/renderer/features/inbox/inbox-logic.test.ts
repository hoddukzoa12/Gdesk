import { describe, expect, it, vi } from 'vitest'
import type { NotificationRow } from '@shared/domain/notification'
import en from '../../locales/en/inbox.json'
import ko from '../../locales/ko/inbox.json'
import {
  DEFAULT_FILTER,
  KNOWN_REASONS,
  fallbackReasonLabel,
  filterItems,
  normalizeFilter,
  openInboxItem,
  reasonLabelKey,
  reasonOptions,
  repoOptions,
  subjectKind
} from './inbox-logic'

function row(
  threadId: string,
  state: NotificationRow['state'],
  reason: string,
  repoFullName: string
): NotificationRow {
  return {
    threadId,
    state,
    reason,
    subjectTitle: `Title ${threadId}`,
    subjectType: 'PullRequest',
    url: `https://github.com/${repoFullName}/pull/${threadId}`,
    repoId: 1,
    repoFullName,
    updatedAt: '2026-10-16T00:00:00Z'
  }
}

const items: NotificationRow[] = [
  row('1', 'unread', 'review_requested', 'o/b'),
  row('2', 'unread', 'mention', 'o/a'),
  row('3', 'read', 'mention', 'o/b'),
  row('4', 'read', 'brand_new_reason', 'o/c')
]

describe('filterItems', () => {
  it('기본 필터는 모두 보여 준다', () => {
    expect(filterItems(items, DEFAULT_FILTER).map((i) => i.threadId)).toEqual(['1', '2', '3', '4'])
  })

  it('안 읽음만', () => {
    const out = filterItems(items, { ...DEFAULT_FILTER, unreadOnly: true })
    expect(out.map((i) => i.threadId)).toEqual(['1', '2'])
  })

  it('저장소·사유·안 읽음을 함께 건다', () => {
    expect(filterItems(items, { ...DEFAULT_FILTER, repo: 'o/b' }).map((i) => i.threadId)).toEqual([
      '1',
      '3'
    ])
    expect(
      filterItems(items, { ...DEFAULT_FILTER, reason: 'mention' }).map((i) => i.threadId)
    ).toEqual(['2', '3'])
    expect(
      filterItems(items, { unreadOnly: true, repo: 'o/b', reason: 'mention' }).map(
        (i) => i.threadId
      )
    ).toEqual([])
  })
})

describe('필터 선택지', () => {
  it('저장소는 항목에 있는 것만 이름순, 중복 없이', () => {
    expect(repoOptions(items)).toEqual(['o/a', 'o/b', 'o/c'])
  })

  it('사유는 알려진 순서가 먼저, 모르는 사유는 뒤에', () => {
    expect(reasonOptions(items)).toEqual(['review_requested', 'mention', 'brand_new_reason'])
  })

  it('고른 저장소·사유가 목록에서 사라지면 그 필터를 푼다', () => {
    const f = { unreadOnly: true, repo: 'o/z', reason: 'mention' }
    expect(normalizeFilter(f, items)).toEqual({ unreadOnly: true, repo: '', reason: 'mention' })
    const same = { unreadOnly: false, repo: 'o/a', reason: '' }
    expect(normalizeFilter(same, items)).toBe(same)
  })
})

describe('사유 문구', () => {
  it('알려진 사유는 en·ko 번역 키가 있다', () => {
    for (const reason of KNOWN_REASONS) {
      const key = reasonLabelKey(reason)
      expect(key).toBe(`reason.${reason}`)
      expect((en.reason as Record<string, string>)[reason]).toBeTruthy()
      expect((ko.reason as Record<string, string>)[reason]).toBeTruthy()
    }
  })

  it('모르는 사유는 null 이고 읽기 좋은 대체 문구를 쓴다', () => {
    expect(reasonLabelKey('brand_new_reason')).toBeNull()
    expect(fallbackReasonLabel('brand_new_reason')).toBe('Brand new reason')
    expect(fallbackReasonLabel('')).toBe('')
  })
})

describe('subjectKind', () => {
  it('GitHub 주제 종류를 아이콘 종류로 바꾼다', () => {
    expect(subjectKind('PullRequest')).toBe('pull')
    expect(subjectKind('Issue')).toBe('issue')
    expect(subjectKind('Release')).toBe('release')
    expect(subjectKind('Discussion')).toBe('discussion')
    expect(subjectKind('Commit')).toBe('commit')
    expect(subjectKind('CheckSuite')).toBe('other')
  })
})

describe('openInboxItem', () => {
  function deps() {
    return {
      openExternal: vi.fn(async () => ({ opened: true })),
      markRead: vi.fn(async () => ({ ok: true }) as const)
    }
  }

  it('안 읽은 항목은 페이지를 열고 읽음 처리한다', async () => {
    const d = deps()
    const result = await openInboxItem(items[0] as NotificationRow, { available: true }, d)
    expect(d.openExternal).toHaveBeenCalledWith(items[0]?.url)
    expect(d.markRead).toHaveBeenCalledWith('1')
    expect(result).toEqual({ ok: true })
  })

  it('읽은 항목은 열기만 한다', async () => {
    const d = deps()
    expect(await openInboxItem(items[2] as NotificationRow, { available: true }, d)).toBeNull()
    expect(d.openExternal).toHaveBeenCalledWith(items[2]?.url)
    expect(d.markRead).not.toHaveBeenCalled()
  })

  it('쓰기를 할 수 없으면(오프라인·가용성 모름) 열기만 한다', async () => {
    for (const availability of [{ available: false, reason: 'offline' } as const, null]) {
      const d = deps()
      expect(await openInboxItem(items[0] as NotificationRow, availability, d)).toBeNull()
      expect(d.openExternal).toHaveBeenCalledTimes(1)
      expect(d.markRead).not.toHaveBeenCalled()
    }
  })

  it('읽음 처리 실패 결과를 그대로 돌려준다', async () => {
    const d = deps()
    const failed = { ok: false, reason: 'failed', message: 'boom' } as const
    d.markRead.mockResolvedValueOnce(failed as never)
    expect(await openInboxItem(items[0] as NotificationRow, { available: true }, d)).toEqual(failed)
  })
})
