import type { DatabaseSync } from 'node:sqlite'
import { registerFetchedDataCleaner } from '../db/cleanup'

/** 캐시 테이블 전체. 새 cache_ 테이블을 만들면 여기에 더한다(테스트가 빠진 것을 잡는다) */
export const CACHE_TABLES = [
  'cache_repositories',
  'cache_pull_requests',
  'cache_pull_request_scopes',
  'cache_issues',
  'cache_issue_scopes',
  'cache_notifications',
  'cache_commits',
  'cache_releases',
  'cache_languages',
  'cache_contributors',
  'cache_stargazers',
  'cache_repo_details',
  'cache_sync_state',
  'cache_notification_done',
  'cache_list_meta',
  'cache_org_restrictions'
] as const

/** 받아온 GitHub 정보를 모두 지운다. clearFetchedData 의 트랜잭션 안에서 불린다 */
export function clearCache(db: DatabaseSync): void {
  for (const table of CACHE_TABLES) db.exec(`DELETE FROM ${table}`)
}

/**
 * 캐시 삭제 함수를 "받아온 정보 전체 삭제"(로그아웃·계정 변경)에 등록한다.
 * 앱 시작 때 한 번 부른다. 같은 함수를 등록하므로 여러 번 불러도 한 번만 실행된다.
 */
export function initCache(): () => void {
  return registerFetchedDataCleaner(clearCache)
}
