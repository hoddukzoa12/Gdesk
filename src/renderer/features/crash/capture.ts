import type { RendererErrorInput } from '@shared/domain/crash'
import '@shared/ipc/crash'
import { invoke } from '@renderer/lib/ipc'

/** 던져진 값(Error 가 아닐 수도 있다)을 메인에 보낼 모양으로 바꾼다. 지우기는 메인이 한다. */
export function toRendererError(value: unknown, fallbackMessage?: string): RendererErrorInput {
  if (value instanceof Error) {
    return { message: `${value.name || 'Error'}: ${value.message}`, stack: value.stack ?? null }
  }
  if (value === undefined || value === null) {
    return { message: fallbackMessage || String(value), stack: null }
  }
  if (typeof value === 'string') return { message: value, stack: null }
  try {
    return { message: JSON.stringify(value) ?? String(value), stack: null }
  } catch {
    return { message: String(value), stack: null }
  }
}

/** 메인에 보낸다. 보내기가 실패해도 새 오류(처리되지 않은 거부)를 만들지 않는다. */
export function reportRendererError(error: RendererErrorInput): void {
  try {
    void invoke('crash:reportRenderer', error).catch(() => {})
  } catch {
    // window.gdesk 가 없으면(미리보기 등) 보낼 곳이 없다
  }
}

/**
 * 화면의 처리되지 않은 오류(`error`)와 거부(`unhandledrejection`)를 메인으로 보낸다.
 * 해제 함수를 돌려준다. 같은 오류 묶기·횟수 제한은 메인이 한다.
 */
export function installCrashListeners(
  target: Window,
  report: (error: RendererErrorInput) => void = reportRendererError
): () => void {
  const onError = (event: ErrorEvent): void => {
    report(toRendererError(event.error, event.message))
  }
  const onRejection = (event: PromiseRejectionEvent): void => {
    report(toRendererError(event.reason))
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
