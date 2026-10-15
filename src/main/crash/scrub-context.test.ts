import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  markRepositoryUnavailable,
  replaceMyRepositories,
  replaceStarredRepositories,
  upsertRepositories
} from '../cache'
import { repoRecord } from '../cache/test-fixtures'
import { openDatabase } from '../db/connection'
import { scrubText } from './scrub'
import { cachedScrubNames } from './scrub-context'

describe('cachedScrubNames: 캐시의 모든 저장소 이름', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(db, [
      repoRecord(1, { owner: 'octo', name: 'private-tool' }),
      repoRecord(2, { owner: 'octo', name: 'old-fork', fork: true, archived: true })
    ])
    replaceStarredRepositories(db, [
      {
        repository: repoRecord(3, { owner: 'facebook', name: 'react' }),
        starredAt: '2026-10-01T00:00:00Z'
      }
    ])
    // 내 것도 스타도 아닌 행: 고정한 남의 저장소·지금 보는 저장소·검색 결과
    upsertRepositories(db, [
      repoRecord(4, { owner: 'secret-client', name: 'internal-portal' }),
      repoRecord(5, { owner: 'someone-else', name: 'searched-repo' })
    ])
    // 접근 불가 자리 행(이름 없음)은 무시한다
    markRepositoryUnavailable(db, 6)
  })
  afterEach(() => db.close())

  it('모든 행의 전체 이름·소유자, 이름만은 내 저장소만', () => {
    const names = cachedScrubNames(db)
    expect([...names.repos].sort()).toEqual([
      'facebook/react',
      'octo/old-fork',
      'octo/private-tool',
      'secret-client/internal-portal',
      'someone-else/searched-repo'
    ])
    expect(new Set(names.owners)).toEqual(
      new Set(['octo', 'facebook', 'secret-client', 'someone-else'])
    )
    expect([...names.repoNames].sort()).toEqual(['old-fork', 'private-tool'])
    expect(names.repos).not.toContain('')
    expect(names.owners).not.toContain('')
  })

  it('보고서에서 내 것이 아닌 저장소 이름과 소유자도 지운다', () => {
    const text = [
      'failed to load secret-client/internal-portal',
      'owner secret-client',
      'search hit someone-else/searched-repo',
      'at node_modules/react/index.js'
    ].join('\n')
    const out = scrubText(text, cachedScrubNames(db))
    expect(out).not.toContain('secret-client')
    expect(out).not.toContain('internal-portal')
    expect(out).not.toContain('someone-else')
    // 스타한 유명 저장소 이름만은 패키지 경로를 망가뜨리지 않게 남긴다
    expect(out).toContain('node_modules/react/index.js')
  })
})
