import type { ConnectionStatus } from '@shared/domain/connection'
import type { RepositorySummary } from '@shared/domain/repo'
import type { GitHubRepoHit, LocalSearchResult } from '@shared/domain/search'
import { matchesText } from './commands'
import type { LabeledCommand, PaletteAction } from './commands'

export type PaletteItemKind = 'command' | 'repo' | 'pr' | 'issue' | 'github' | 'clone'

export interface PaletteItem {
  /** `<kind>-<id>`. 테스트 ID 는 `palette-item-<key>` */
  key: string
  kind: PaletteItemKind
  title: string
  subtitle?: string | null
  /** 오른쪽 끝의 짧은 표시(예: `#42`, 스타 수) */
  hint?: string | null
  action: PaletteAction
}

export type SectionId = 'commands' | 'repositories' | 'pullRequests' | 'issues' | 'github' | 'clone'

/** GitHub 구역 상태. idle 은 구역을 그리지 않는다 */
export type GitHubSectionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; items: GitHubRepoHit[] }
  | { status: 'offline' | 'rate_limited' | 'error' }
  | { status: 'session_expired' | 'api_limited' }

export interface PaletteSection {
  id: SectionId
  items: PaletteItem[]
  /** 결과 대신 보일 안내 */
  note?:
    'loading' | 'empty' | 'offline' | 'session_expired' | 'api_limited' | 'rate_limited' | 'error'
}

/**
 * 연결 상태가 online 이 아니면 GitHub 검색을 보내지 않고 보일 상태. online 이거나 아직 모르면 null.
 * 연결 상태의 rate_limited(API 요청 한도)는 검색 응답의 rate_limited(검색 한도)와 문구가 달라 api_limited 로 둔다.
 */
export function blockedGitHubState(
  connection: ConnectionStatus | undefined
): GitHubSectionState | null {
  switch (connection) {
    case undefined:
    case 'online':
      return null
    case 'rate_limited':
      return { status: 'api_limited' }
    default:
      return { status: connection }
  }
}

export interface BuildSectionsInput {
  commands: LabeledCommand[]
  local: LocalSearchResult | null
  github: GitHubSectionState
}

const commandItem = (c: LabeledCommand): PaletteItem => ({
  key: `command-${c.id}`,
  kind: 'command',
  title: c.label,
  action: c.action
})

const repoItem = (r: RepositorySummary): PaletteItem => ({
  key: `repo-${r.id}`,
  kind: 'repo',
  title: r.fullName,
  subtitle: r.description,
  action: { type: 'navigate', path: `/repos/${r.id}` }
})

/**
 * 기본 모드의 구역들. 순서: 명령 → 저장소 → PR → 이슈 → GitHub.
 * 비어 있는 앱 안 구역은 빼고, GitHub 구역은 검색 중·결과 없음·오프라인 등도 안내로 보인다.
 */
export function buildSections({ commands, local, github }: BuildSectionsInput): PaletteSection[] {
  const sections: PaletteSection[] = []
  if (commands.length > 0) sections.push({ id: 'commands', items: commands.map(commandItem) })
  if (local) {
    if (local.repositories.length > 0) {
      sections.push({ id: 'repositories', items: local.repositories.map(repoItem) })
    }
    if (local.pullRequests.length > 0) {
      sections.push({
        id: 'pullRequests',
        items: local.pullRequests.map((pr) => ({
          key: `pr-${pr.id}`,
          kind: 'pr',
          title: pr.title,
          subtitle: pr.repoFullName,
          hint: `#${pr.number}`,
          action: { type: 'external', url: pr.url }
        }))
      })
    }
    if (local.issues.length > 0) {
      sections.push({
        id: 'issues',
        items: local.issues.map((issue) => ({
          key: `issue-${issue.id}`,
          kind: 'issue',
          title: issue.title,
          subtitle: issue.repoFullName,
          hint: `#${issue.number}`,
          action: { type: 'external', url: issue.url }
        }))
      })
    }
  }
  switch (github.status) {
    case 'idle':
      break
    case 'ok':
      sections.push(
        github.items.length > 0
          ? {
              id: 'github',
              items: github.items.map((hit) => ({
                key: `github-${hit.id}`,
                kind: 'github',
                title: hit.fullName,
                subtitle: hit.description,
                hint: `★ ${hit.stargazerCount}`,
                action: { type: 'navigate', path: `/repos/${hit.id}` }
              }))
            }
          : { id: 'github', items: [], note: 'empty' }
      )
      break
    default:
      sections.push({ id: 'github', items: [], note: github.status })
  }
  return sections
}

/** 클론 모드: 내 저장소(이름·설명으로 거름) + 앱 안 검색 저장소(중복 제외) */
export function buildCloneSection(
  myRepos: readonly RepositorySummary[],
  localRepos: readonly RepositorySummary[],
  text: string,
  limit = 50
): PaletteSection {
  const seen = new Set<number>()
  const items: PaletteItem[] = []
  for (const r of [
    ...myRepos.filter((r) => matchesText(`${r.fullName} ${r.description ?? ''}`, text)),
    ...localRepos
  ]) {
    if (seen.has(r.id) || r.accessStatus === 'unavailable') continue
    seen.add(r.id)
    items.push({
      key: `clone-${r.id}`,
      kind: 'clone',
      title: r.fullName,
      subtitle: r.description,
      action: { type: 'clone', target: { repoId: r.id, owner: r.owner, name: r.name } }
    })
    if (items.length >= limit) break
  }
  return { id: 'clone', items, note: items.length === 0 ? 'empty' : undefined }
}

export function flattenItems(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items)
}

/** ↑/↓ 이동. 끝에서 반대쪽 끝으로 돈다. 항목이 없으면 -1 */
export function moveIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return -1
  const from = index < 0 || index >= count ? (delta > 0 ? -1 : count) : index
  return (((from + delta) % count) + count) % count
}
