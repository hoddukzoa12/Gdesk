/**
 * 알림 subject(API 주소) → 브라우저로 열 GitHub 웹 주소.
 * 기준 주소는 알림의 repository.html_url 이다(가짜 서버·다른 호스트에서도 일관되게).
 */
export interface NotificationSubjectRef {
  type: string
  url: string | null
}

export function notificationHtmlUrl(subject: NotificationSubjectRef, repoHtmlUrl: string): string {
  const repo = repoHtmlUrl.replace(/\/+$/, '')
  const path = subject.url ? safePath(subject.url) : null
  if (path) {
    const pull = /\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(path)
    if (pull) return `${repo}/pull/${pull[1]}`
    const issue = /\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path)
    if (issue) return `${repo}/issues/${issue[1]}`
    const commit = /\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-fA-F]+)$/.exec(path)
    if (commit) return `${repo}/commit/${commit[1]}`
    if (/\/repos\/[^/]+\/[^/]+\/releases\//.test(path)) return `${repo}/releases`
  }
  switch (subject.type) {
    case 'Release':
      return `${repo}/releases`
    case 'Discussion':
      return `${repo}/discussions`
    case 'CheckSuite':
    case 'WorkflowRun':
      return `${repo}/actions`
    default:
      return repo
  }
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}
