/** `rel` 이름 → 주소. 예: { next, prev, first, last } */
export type LinkRelations = Partial<Record<string, string>>

/** RFC 8288 `Link` 헤더를 읽는다. GitHub 페이지 나누기용. */
export function parseLinkHeader(header: string | null | undefined): LinkRelations {
  const out: LinkRelations = {}
  if (!header) return out
  for (const part of header.split(',')) {
    const match = /<([^>]*)>\s*;(.*)/.exec(part.trim())
    if (!match) continue
    const url = match[1] ?? ''
    const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(match[2] ?? '')?.[1]
    if (!url || !rel) continue
    for (const name of rel.trim().split(/\s+/)) out[name] = url
  }
  return out
}
