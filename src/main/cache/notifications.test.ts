import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import {
  countUnreadNotifications,
  getNotification,
  listNotifications,
  markNotificationRead,
  mergeNotifications,
  removeNotification,
  replaceNotifications,
  restoreNotification
} from './notifications'
import { notificationRecord } from './test-fixtures'

describe('알림 캐시', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceNotifications(db, [
      notificationRecord('1', { updatedAt: '2026-10-01T00:00:00Z', reason: 'mention' }),
      notificationRecord('2', { updatedAt: '2026-10-03T00:00:00Z', state: 'read', repoId: 2 }),
      notificationRecord('3', { updatedAt: '2026-10-02T00:00:00Z', reason: 'review_requested' })
    ])
  })
  afterEach(() => db.close())

  it.each([
    [{}, ['2', '3', '1']],
    [{ unreadOnly: true }, ['3', '1']],
    [{ repoId: 2 }, ['2']],
    [{ reason: 'review_requested' }, ['3']],
    [{ limit: 1 }, ['2']]
  ] as const)('%o → %o', (options, ids) => {
    expect(listNotifications(db, options).map((n) => n.threadId)).toEqual(ids)
  })

  it('목록 전체를 바꾸면 완료된(빠진) 스레드는 사라진다', () => {
    replaceNotifications(db, [notificationRecord('3')])
    expect(listNotifications(db).map((n) => n.threadId)).toEqual(['3'])
  })

  it('읽음 처리 후 되돌리기', () => {
    const prev = markNotificationRead(db, '1')
    expect(prev?.state).toBe('unread')
    expect(getNotification(db, '1')?.state).toBe('read')
    expect(countUnreadNotifications(db)).toBe(1)
    restoreNotification(db, prev!)
    expect(getNotification(db, '1')?.state).toBe('unread')
    expect(countUnreadNotifications(db)).toBe(2)
    expect(markNotificationRead(db, 'nope')).toBeNull()
  })

  it('완료(삭제) 후 되돌리기', () => {
    const prev = removeNotification(db, '3')
    expect(prev).toMatchObject({ threadId: '3', reason: 'review_requested' })
    expect(getNotification(db, '3')).toBeNull()
    restoreNotification(db, prev!)
    expect(getNotification(db, '3')).toEqual(prev)
    expect(removeNotification(db, 'nope')).toBeNull()
  })

  it('완료한 스레드는 같은 갱신 시각으로 다시 와도 숨기고, 새 활동이면 다시 보인다', () => {
    removeNotification(db, '3')
    // 완료 전에 시작한 갱신이 같은 스레드를 돌려줌
    replaceNotifications(db, [
      notificationRecord('3', { updatedAt: '2026-10-02T00:00:00Z' }),
      notificationRecord('1')
    ])
    expect(getNotification(db, '3')).toBeNull()
    mergeNotifications(db, [notificationRecord('3', { updatedAt: '2026-10-02T00:00:00Z' })])
    expect(getNotification(db, '3')).toBeNull()
    // 새 활동
    replaceNotifications(db, [notificationRecord('3', { updatedAt: '2026-10-09T00:00:00Z' })])
    expect(getNotification(db, '3')?.updatedAt).toBe('2026-10-09T00:00:00Z')
    // 기록이 지워졌으므로 다시 완료하기 전까지는 계속 보인다
    replaceNotifications(db, [notificationRecord('3', { updatedAt: '2026-10-09T00:00:00Z' })])
    expect(getNotification(db, '3')).not.toBeNull()
  })

  it('완료를 되돌리면 완료 기록도 지운다', () => {
    const prev = removeNotification(db, '3')
    restoreNotification(db, prev!)
    replaceNotifications(db, [notificationRecord('3', { updatedAt: '2026-10-02T00:00:00Z' })])
    expect(getNotification(db, '3')).not.toBeNull()
  })

  it('mergeNotifications 는 기존 스레드를 지우지 않고 넣거나 갱신한다', () => {
    mergeNotifications(db, [notificationRecord('9'), notificationRecord('1', { state: 'read' })])
    expect(
      listNotifications(db)
        .map((n) => n.threadId)
        .sort()
    ).toEqual(['1', '2', '3', '9'])
    expect(getNotification(db, '1')?.state).toBe('read')
  })
})
