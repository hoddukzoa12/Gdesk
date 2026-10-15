import { describe, expect, it } from 'vitest'
import { notificationHtmlUrl } from './notification-url'

const REPO = 'https://github.com/acme/widget'
const API = 'https://api.github.com/repos/acme/widget'

describe('notificationHtmlUrl', () => {
  it.each([
    ['PullRequest', `${API}/pulls/12`, `${REPO}/pull/12`],
    ['Issue', `${API}/issues/7`, `${REPO}/issues/7`],
    ['Commit', `${API}/commits/abc123`, `${REPO}/commit/abc123`],
    ['Release', `${API}/releases/99`, `${REPO}/releases`],
    ['Discussion', null, `${REPO}/discussions`],
    ['CheckSuite', null, `${REPO}/actions`],
    ['RepositoryVulnerabilityAlert', null, REPO],
    ['Issue', 'https://api.github.com/repos/other/thing/issues/3', `${REPO}/issues/3`]
  ] as const)('%s %s → %s', (type, url, expected) => {
    expect(notificationHtmlUrl({ type, url }, REPO)).toBe(expected)
  })

  it('저장소 주소 끝 / 를 정리한다', () => {
    expect(notificationHtmlUrl({ type: 'Issue', url: `${API}/issues/1` }, `${REPO}/`)).toBe(
      `${REPO}/issues/1`
    )
  })
})
