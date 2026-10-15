import '@shared/ipc/data'
import { emit } from './registry'

/** 캐시가 바뀐 범위를 모든 창에 알린다(동기화·쓰기 동작이 호출). */
export function notifyDataChanged(keys: string[]): void {
  if (keys.length > 0) emit('data:changed', { keys: [...new Set(keys)] })
}
