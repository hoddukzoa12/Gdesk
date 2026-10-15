import type { CiStatus } from '@shared/domain/ci'
import type { CommitSummary, LanguageShare } from '@shared/domain/repo'

/**
 * 기본 브랜치 CI 요약 단어의 상태: 최신 커밋(commits[0])의 상태. 커밋이 없으면 none.
 * 화면 문구는 common:ci.* (Passing / Failing / Pending / No CI) 를 쓴다.
 */
export function ciSummary(commits: readonly Pick<CommitSummary, 'ciStatus'>[]): CiStatus {
  return commits[0]?.ciStatus ?? 'none'
}

/** MiniBars 용 상태 목록: 오래된 것 → 최신 순(최대 7개). commits 는 최신 → 과거 순이다. */
export function ciBars(commits: readonly Pick<CommitSummary, 'ciStatus'>[], max = 7): CiStatus[] {
  return commits
    .slice(0, max)
    .map((c) => c.ciStatus)
    .reverse()
}

/** 이름에서 늘 같은 색을 만든다(GitHub 언어 색이 없을 때). */
export function languageColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 55% 55%)`
}

/** 0..1 비율을 "96%" / "<1%" / "0%" 로 */
export function formatPercent(ratio: number): string {
  const pct = ratio * 100
  if (pct <= 0) return '0%'
  if (pct < 1) return '<1%'
  return `${Math.round(pct)}%`
}

export interface LanguageBarItem {
  /** 언어 이름. 나머지를 합친 항목은 null */
  name: string | null
  color: string
  /** 0..100 (막대 너비) */
  percent: number
  /** 표시 문구("96%", "<1%") */
  label: string
}

/** 나머지 묶음 색(테마 토큰) */
export const OTHER_LANGUAGE_COLOR = 'var(--color-neutral)'

/**
 * 언어 비율 막대·목록 항목. 크기 순으로 `top` 개를 보여 주고, 남은 언어는 하나(name=null, 기타)로 합친다.
 * 비율은 bytes 합으로 다시 계산한다(서버 ratio 와 같지만 합이 0 이면 빈 목록).
 */
export function languageBars(languages: readonly LanguageShare[], top = 5): LanguageBarItem[] {
  const total = languages.reduce((n, l) => n + Math.max(0, l.bytes), 0)
  if (total <= 0) return []
  const sorted = [...languages]
    .filter((l) => l.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  const head = sorted.length > top + 1 ? sorted.slice(0, top) : sorted
  const rest = sorted.slice(head.length)
  const items: LanguageBarItem[] = head.map((l) => {
    const ratio = l.bytes / total
    return {
      name: l.name,
      color: l.color ?? languageColor(l.name),
      percent: ratio * 100,
      label: formatPercent(ratio)
    }
  })
  if (rest.length > 0) {
    const ratio = rest.reduce((n, l) => n + l.bytes, 0) / total
    items.push({
      name: null,
      color: OTHER_LANGUAGE_COLOR,
      percent: ratio * 100,
      label: formatPercent(ratio)
    })
  }
  return items
}

/** 이슈 라벨 색(6자리 16진수, # 없음) → CSS 색. 잘못된 값이면 null */
export function labelColor(color: string | null): string | null {
  return color && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : null
}

/** 저장소 웹 주소 아래 경로 */
export function repoLink(repoUrl: string, path: string): string {
  return `${repoUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
