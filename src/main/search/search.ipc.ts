import '@shared/ipc/search'
import { getDb } from '../db/db'
import { getGitHubClient } from '../github/client'
import { handle } from '../ipc/registry'
import { createSearchService } from './search.service'

// 빠른 검색창(spec §4.12). DB·클라이언트는 호출 시점에 가져온다.
export function registerIpc(): void {
  const service = createSearchService({ db: getDb, client: getGitHubClient })
  handle('search:local', (req) => service.local(req?.text))
  handle('search:github', (req) => service.github(req?.text))
}
