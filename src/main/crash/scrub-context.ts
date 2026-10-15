import type { DatabaseSync } from 'node:sqlite'
import { listAllRepositoryNames, listMyRepositories } from '../cache'

/** 오류 보고에서 지울, 캐시가 아는 이름들 */
export interface CachedScrubNames {
  /** `소유자/이름` */
  repos: string[]
  /** 소유자(사용자·조직) 이름 */
  owners: string[]
  /** 이름만으로도 지울 저장소 이름(내 저장소만) */
  repoNames: string[]
}

/**
 * 캐시의 이름을 모은다. Electron 없이 테스트할 수 있게 crash/index.ts 에서 떼어 냈다.
 * - 캐시의 모든 저장소 행(내 저장소, 스타, 고정한 남의 저장소, 지금 보는 저장소, 검색 결과 등):
 *   전체 이름과 소유자
 * - 내 저장소(포크·보관 포함): 이름만까지. 스타·검색한 유명 저장소 이름(react 등)까지 넣으면 스택의
 *   `node_modules/react` 같은 부분이 모두 지워져 보고서가 쓸모없어진다.
 */
export function cachedScrubNames(db: DatabaseSync): CachedScrubNames {
  const out: CachedScrubNames = { repos: [], owners: [], repoNames: [] }
  for (const repo of listAllRepositoryNames(db)) {
    // 접근 불가 자리 행은 이름이 비어 있다
    if (repo.fullName) out.repos.push(repo.fullName)
    if (repo.owner) out.owners.push(repo.owner)
  }
  for (const repo of listMyRepositories(db, { includeForks: true, includeArchived: true })) {
    if (repo.name) out.repoNames.push(repo.name)
  }
  return out
}
