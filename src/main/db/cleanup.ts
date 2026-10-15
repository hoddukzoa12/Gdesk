import type { DatabaseSync } from 'node:sqlite'
import { getDb } from './db'
import { withTransaction } from './transaction'

/**
 * 계정 단위 삭제(spec 5).
 * - 로그아웃: `clearFetchedData()` — 가져온 GitHub 정보만 지운다. 고정·연결·설정·계정 정보는 남긴다.
 * - 다른 계정 로그인: `clearAccountData()` — 가져온 정보와 고정·연결을 지운다. 설정·계정 정보는 남긴다.
 * 어느 쪽도 디스크의 폴더는 건드리지 않는다.
 */
export type FetchedDataCleaner = (db: DatabaseSync) => void

const cleaners = new Set<FetchedDataCleaner>()
const accountClearedListeners = new Set<() => void>()

/** 가져온 GitHub 정보(캐시 테이블)를 지우는 함수를 등록한다. 해제 함수를 돌려준다. */
export function registerFetchedDataCleaner(fn: FetchedDataCleaner): () => void {
  cleaners.add(fn)
  return () => {
    cleaners.delete(fn)
  }
}

/** 테스트용: 등록된 정리 함수를 모두 지운다. */
export function resetFetchedDataCleaners(): void {
  cleaners.clear()
}

/** clearAccountData 로 고정·연결이 지워진 뒤 알림을 받는다(예: pins:changed 보내기). */
export function onAccountDataCleared(listener: () => void): () => void {
  accountClearedListeners.add(listener)
  return () => {
    accountClearedListeners.delete(listener)
  }
}

function runCleaners(db: DatabaseSync): void {
  for (const fn of [...cleaners]) fn(db)
}

/** 로그아웃: 가져온 GitHub 정보만 지운다. */
export function clearFetchedData(db: DatabaseSync = getDb()): void {
  withTransaction(db, () => runCleaners(db))
}

/** 다른 계정 로그인: 가져온 정보 + 고정 + 로컬 연결(DB 행만)을 지운다. 설정·계정 정보는 그대로. */
export function clearAccountData(db: DatabaseSync = getDb()): void {
  withTransaction(db, () => {
    runCleaners(db)
    db.exec('DELETE FROM pins')
    db.exec('DELETE FROM local_links')
  })
  for (const listener of [...accountClearedListeners]) listener()
}
