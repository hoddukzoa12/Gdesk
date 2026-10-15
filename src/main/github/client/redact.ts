/**
 * 오류 문구에서 토큰을 지운다. 오류는 로그·오류 보고로 흘러갈 수 있으므로
 * 이 계층에서 만드는 모든 오류 문구는 여기를 거친다.
 */
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g

export const REDACTED = '[REDACTED]'

export function redact(text: string, token?: string | null): string {
  let out = text
  if (token && token.length >= 4) out = out.split(token).join(REDACTED)
  return out.replace(GITHUB_TOKEN_PATTERN, REDACTED)
}
