import type { CrashProcess, CrashReport, CrashSendMode } from '@shared/domain/crash'
import { buildCrashReport, normalizeError, type ErrorInfo, type ReportEnv } from './report'
import type { ScrubContext } from './scrub'

export interface CrashLimiterOptions {
  /** 같은 오류를 다시 보고하지 않는 시간(ms). 반복되는 동안에는 계속 늘어난다. */
  debounceMs?: number
  /** 한 실행에서 띄우는 보고서 최대 수 */
  maxReports?: number
  now?: () => number
}

export interface CrashLimiter {
  /** 이 오류(key)를 보고해도 되는지. true 면 보고 수에 센다. */
  allow(key: string): boolean
}

export const DEFAULT_DEBOUNCE_MS = 10_000
export const DEFAULT_MAX_REPORTS = 3

/** 오류 고리 방지: 같은 오류 묶기(debounce) + 실행당 보고 수 제한(cap) */
export function createCrashLimiter(options: CrashLimiterOptions = {}): CrashLimiter {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS
  const now = options.now ?? Date.now
  const lastSeen = new Map<string, number>()
  let count = 0

  return {
    allow(key) {
      // 제한에 닿은 뒤에는 아무것도 기억하지 않는다(서로 다른 오류가 끝없이 와도 메모리가 늘지 않게)
      if (count >= maxReports) return false
      const t = now()
      const prev = lastSeen.get(key)
      lastSeen.set(key, t)
      if (prev !== undefined && t - prev < debounceMs) return false
      count += 1
      return true
    }
  }
}

export interface CrashServiceDeps {
  env: () => ReportEnv
  /** 보고서를 만들 때마다 부른다(그때의 로그인·캐시 이름을 쓴다). 던져도 된다. */
  scrubContext: () => ScrubContext
  sendMode: () => CrashSendMode
  /** 창에 보고서를 보낸다(crash:show) */
  show: (report: CrashReport) => void
  /** 지운 글만 남긴다(토큰·경로가 로그에도 나오지 않게) */
  log: (text: string) => void
  now?: () => number
  limiter?: CrashLimiter
}

export interface CrashService {
  /** 오류를 받아 보고서를 만들고 띄운다. 묶이거나 제한에 걸리면 null. 절대 던지지 않는다. */
  capture(process: CrashProcess, error: unknown): CrashReport | null
  /** 아직 닫지 않은 보고서 */
  pending(): CrashReport[]
  get(id: string): CrashReport | null
  dismiss(id: string): void
}

function errorKey(process: CrashProcess, info: ErrorInfo): string {
  return `${process}\n${info.message}\n${info.stack}`
}

export function createCrashService(deps: CrashServiceDeps): CrashService {
  const limiter = deps.limiter ?? createCrashLimiter({ now: deps.now })
  const reports = new Map<string, CrashReport>()
  let seq = 0

  function safeLog(text: string): void {
    try {
      deps.log(text)
    } catch {
      // 로그도 실패하면 더 할 수 있는 것이 없다
    }
  }

  function scrubContext(): ScrubContext {
    try {
      return deps.scrubContext()
    } catch (err) {
      // 문맥 없이도 토큰 모양·경로·GitHub 주소는 지운다
      safeLog(`[crash] could not read scrub context: ${normalizeError(err).message}`)
      return {}
    }
  }

  return {
    capture(process, error) {
      try {
        const info = normalizeError(error)
        if (!limiter.allow(errorKey(process, info))) return null
        seq += 1
        const report = buildCrashReport({
          id: `crash-${seq}`,
          process,
          error: info,
          env: deps.env(),
          scrub: scrubContext(),
          sendMode: deps.sendMode()
        })
        reports.set(report.id, report)
        safeLog(`[crash] ${report.title}\n${report.stack}`)
        try {
          deps.show(report)
        } catch (err) {
          // 창이 없거나 닫히는 중이면 crash:pending 으로 나중에 가져간다
          safeLog(`[crash] could not show report: ${normalizeError(err).message}`)
        }
        return report
      } catch (err) {
        safeLog(`[crash] could not build report: ${normalizeError(err).message}`)
        return null
      }
    },
    pending() {
      return [...reports.values()]
    },
    get(id) {
      return reports.get(id) ?? null
    },
    dismiss(id) {
      reports.delete(id)
    }
  }
}
