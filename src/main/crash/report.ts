import type { CrashProcess, CrashReport, CrashSendMode } from '@shared/domain/crash'
import { parseRepo } from '../updater/mode'
import { scrubText, type ScrubContext } from './scrub'

/** 보고서 머리에 넣는 실행 환경 */
export interface ReportEnv {
  appVersion: string
  /** process.platform */
  platform: string
  osVersion: string
}

/** 지우기 전의 오류 내용 */
export interface ErrorInfo {
  message: string
  stack: string
}

const MAX_MESSAGE = 2_000
const MAX_STACK = 16_000
const MAX_TITLE = 120

/** 새 이슈 주소의 안전한 최대 길이. 브라우저·GitHub 가 받아 주는 범위 안에서 넉넉히 잡는다. */
export const ISSUE_URL_MAX_LENGTH = 8_000
const TRUNCATED_NOTE = '\n\n(truncated)'

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** 던져진 값(Error 가 아닐 수도 있다)을 메시지·스택으로 바꾼다. 길이를 자른다. */
export function normalizeError(value: unknown): ErrorInfo {
  if (value instanceof Error) {
    const name = value.name || 'Error'
    return {
      message: clip(`${name}: ${value.message}`, MAX_MESSAGE),
      stack: clip(value.stack ?? '', MAX_STACK)
    }
  }
  if (value !== null && typeof value === 'object' && 'message' in value) {
    const { message, stack } = value as { message: unknown; stack?: unknown }
    return {
      message: clip(stringify(message), MAX_MESSAGE),
      stack: clip(typeof stack === 'string' ? stack : '', MAX_STACK)
    }
  }
  return { message: clip(stringify(value), MAX_MESSAGE), stack: '' }
}

export function osDisplayName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

/** 내용 안의 백틱보다 긴 코드 울타리로 감싼다. */
function fenced(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${content}\n${fence}`
}

export interface BuildCrashReportInput {
  id: string
  process: CrashProcess
  error: ErrorInfo
  env: ReportEnv
  scrub: ScrubContext
  sendMode: CrashSendMode
}

/** 보고서를 만든다. 메시지·스택은 여기서 지운다. 사용자가 보는 글과 보내는 글이 같다. */
export function buildCrashReport(input: BuildCrashReportInput): CrashReport {
  const { env } = input
  const message = scrubText(clip(input.error.message, MAX_MESSAGE), input.scrub)
  const stack = scrubText(clip(input.error.stack, MAX_STACK), input.scrub)
  const osName = osDisplayName(env.platform)
  const firstLine = message.split('\n', 1)[0]?.trim() || 'Unknown error'
  const title = clip(`[crash] ${input.process}: ${firstLine}`, MAX_TITLE)

  const lines = [
    '## Error report',
    '',
    `- Gdesk: ${env.appVersion}`,
    `- OS: ${osName} ${env.osVersion}`.trimEnd(),
    `- Process: ${input.process}`,
    '',
    '### Message',
    '',
    fenced(message)
  ]
  if (stack) lines.push('', '### Stack', '', fenced(stack))

  return {
    id: input.id,
    process: input.process,
    appVersion: env.appVersion,
    osName,
    osVersion: env.osVersion,
    message,
    stack,
    title,
    body: lines.join('\n'),
    sendMode: input.sendMode
  }
}

/** 문자열 앞쪽을 자를 때 서로게이트 쌍 가운데를 자르지 않는다(encodeURIComponent 가 던진다). */
function safePrefix(value: string, length: number): string {
  let end = Math.max(0, Math.min(length, value.length))
  const code = value.charCodeAt(end - 1)
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1
  return value.slice(0, end)
}

/**
 * Gdesk 저장소의 새 이슈 작성 주소. 길이 제한을 넘으면 본문 끝을 잘라 "(truncated)" 를 붙인다.
 * 제한은 인코딩한 뒤의 길이에 적용한다(한글은 인코딩하면 3배 이상 길어진다).
 */
export function buildIssueUrl(
  repo: string,
  title: string,
  body: string,
  maxLength: number = ISSUE_URL_MAX_LENGTH
): { url: string; truncated: boolean } {
  const ref = parseRepo(repo)
  if (!ref) throw new Error('Invalid Gdesk repository')
  const prefix =
    `https://github.com/${ref.owner}/${ref.repo}/issues/new` +
    `?title=${encodeURIComponent(title)}&body=`

  const full = prefix + encodeURIComponent(body)
  if (full.length <= maxLength) return { url: full, truncated: false }

  // 들어가는 가장 긴 앞부분을 이분 탐색으로 찾는다(인코딩 길이는 앞부분 길이에 대해 단조 증가)
  const fits = (n: number): boolean =>
    prefix.length + encodeURIComponent(safePrefix(body, n) + TRUNCATED_NOTE).length <= maxLength
  let lo = 0
  let hi = body.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  const cut = safePrefix(body, lo).trimEnd()
  return { url: prefix + encodeURIComponent(cut + TRUNCATED_NOTE), truncated: true }
}
