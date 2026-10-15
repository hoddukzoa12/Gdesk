import type { SQLInputValue } from 'node:sqlite'

/**
 * node:sqlite 값 변환 도우미. node:sqlite 는 boolean·undefined 를 바인딩하지 못하고,
 * 읽은 행은 Record<string, unknown> 이라 필드마다 형을 맞춘다.
 */
export type Row = Record<string, unknown>

export function sqlBool(value: boolean): number {
  return value ? 1 : 0
}

export function sqlOpt(value: string | number | null | undefined): SQLInputValue {
  return value === undefined ? null : value
}

export function str(row: Row, key: string): string {
  const v = row[key]
  return v === null || v === undefined ? '' : String(v)
}

export function strOrNull(row: Row, key: string): string | null {
  const v = row[key]
  return v === null || v === undefined ? null : String(v)
}

export function num(row: Row, key: string): number {
  const v = Number(row[key])
  return Number.isFinite(v) ? v : 0
}

export function numOrNull(row: Row, key: string): number | null {
  const v = row[key]
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function bool(row: Row, key: string): boolean {
  return Number(row[key]) === 1
}

export function jsonValue<T>(row: Row, key: string, fallback: T): T {
  const v = row[key]
  if (typeof v !== 'string' || v === '') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

/** `IN (?, ?, …)` 자리표시자 */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}

/** LIKE 검색어의 %, _, \ 를 이스케이프한다(ESCAPE '\\' 와 함께 쓴다) */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
