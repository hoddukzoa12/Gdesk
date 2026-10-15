/** 외부 링크로 열어도 되는 주소인지. http(s) 만 허용한다(spec 11-8). */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return url.protocol === 'https:' || url.protocol === 'http:'
}

/** 안전한 주소만 기본 브라우저로 연다. 열었으면 true. */
export async function openExternalSafe(
  raw: string,
  open: (url: string) => Promise<void>
): Promise<boolean> {
  if (!isSafeExternalUrl(raw)) return false
  await open(raw)
  return true
}
