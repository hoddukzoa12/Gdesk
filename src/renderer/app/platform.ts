import '@shared/ipc/app'
import type { AppPlatform } from '@shared/domain/app'
import { useIpcQuery } from '../lib/ipc'

function guessPlatform(): AppPlatform {
  if (typeof navigator === 'undefined') return 'linux'
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  return 'linux'
}

/** 실행 중인 OS. `app:info` 응답 전에는 userAgent 로 추정한다. */
export function usePlatform(): AppPlatform {
  const info = useIpcQuery('app:info')
  return info.data?.platform ?? guessPlatform()
}
