import type { LocalLink } from '../domain/link'
import type {
  CloneOutcome,
  CloneProgressEvent,
  CloneRequest,
  EditorInfo,
  LinkOutcome,
  LinkRequest,
  OpenOutcome,
  OpenRequest,
  ScanSummary
} from '../domain/local'

// 로컬 폴더 연결·클론·열기(spec 4.10, 4.11).
// 연결이 바뀌면 'data:changed' 로 `repo:<id>`·`sidebar` 를 알린다.
declare module './contract' {
  interface IpcInvokeChannels {
    /** repoId 를 주면 그 저장소의 연결만. 최근 사용 순 */
    'local:listLinks': { req: { repoId?: number }; res: LocalLink[] }
    'local:listEditors': { req: void; res: EditorInfo[] }
    /** 끝날 때(클론·이미 있음·취소·실패)까지 기다린다. 진행률은 local:cloneProgress */
    'local:clone': { req: CloneRequest; res: CloneOutcome }
    'local:cancelClone': { req: { cloneId: string }; res: { cancelled: boolean } }
    'local:rescan': { req: void; res: ScanSummary }
    'local:link': { req: LinkRequest; res: LinkOutcome }
    /** 연결(DB 행)만 지운다. 폴더는 건드리지 않는다 */
    'local:unlink': { req: { linkId: number }; res: { removed: boolean } }
    /** 새 경로로 다시 연결한다. 성공하면 links[0] 이 새 연결(ID 가 바뀔 수 있다) */
    'local:relink': { req: { linkId: number; path: string }; res: LinkOutcome }
    'local:open': { req: OpenRequest; res: OpenOutcome }
  }
  interface IpcEventChannels {
    'local:cloneProgress': CloneProgressEvent
  }
}

export {}
