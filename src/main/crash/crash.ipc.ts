import { clipboard, shell } from 'electron'
import { crashReportText } from '@shared/domain/crash'
import '@shared/ipc/crash'
import { openExternalSafe } from '../app/external'
import { GDESK_REPO, isTestMode } from '../config'
import { emit, handle } from '../ipc/registry'
import { getCrashService } from './index'
import { buildIssueUrl } from './report'

const TEST_ERROR_MESSAGE = 'Gdesk crash test'

export function registerIpc(): void {
  handle('crash:reportRenderer', (req) => {
    // 화면이 보낸 값은 믿지 않는다: 모양을 확인하고 길이는 보고서를 만들 때 자른다
    if (!req || typeof req !== 'object' || typeof req.message !== 'string')
      return { accepted: false }
    const stack = typeof req.stack === 'string' ? req.stack : ''
    const report = getCrashService().capture('renderer', { message: req.message, stack })
    return { accepted: report !== null }
  })

  handle('crash:pending', () => getCrashService().pending())

  handle('crash:dismiss', (req) => {
    if (typeof req?.id === 'string') getCrashService().dismiss(req.id)
  })

  // 사용자가 "보내기"를 눌렀을 때만 온다. 보고서는 메인이 가진 지운 글을 쓴다(화면이 보낸 글이 아니라).
  handle('crash:openIssue', async (req) => {
    const report = typeof req?.id === 'string' ? getCrashService().get(req.id) : null
    if (!report || report.sendMode !== 'issue' || !GDESK_REPO.trim()) {
      return { opened: false, truncated: false }
    }
    const { url, truncated } = buildIssueUrl(GDESK_REPO.trim(), report.title, report.body)
    const opened = await openExternalSafe(url, (safe) => shell.openExternal(safe))
    return { opened, truncated }
  })

  handle('crash:copy', (req) => {
    const report = typeof req?.id === 'string' ? getCrashService().get(req.id) : null
    if (!report) return { copied: false }
    clipboard.writeText(crashReportText(report))
    return { copied: true }
  })

  // 화면 자동 테스트가 대화상자를 열 수 있게 일부러 오류를 낸다. 테스트 모드에서만.
  handle('crash:testTrigger', (req) => {
    if (!isTestMode()) return { accepted: false }
    const where = req?.where
    if (where === 'main') {
      // invoke 의 거부가 아니라 진짜 처리되지 않은 오류가 되도록 다음 차례에 던진다
      setImmediate(() => {
        throw new Error(`${TEST_ERROR_MESSAGE} (main)`)
      })
      return { accepted: true }
    }
    if (where === 'renderer') {
      emit('crash:testThrow', { message: `${TEST_ERROR_MESSAGE} (renderer)` })
      return { accepted: true }
    }
    return { accepted: false }
  })
}
