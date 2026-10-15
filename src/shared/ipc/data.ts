// 캐시(받아온 정보)가 바뀌었음을 화면에 알리는 공용 이벤트.
// keys 예: 'home' | 'inbox' | 'pulls' | 'reviews' | 'issues' | 'starred' | 'repositories' | 'sidebar'
//         | `repo:<저장소 ID>`. 화면은 이 이벤트를 받으면 `query:` 로 시작하는 조회를 다시 읽는다.
declare module './contract' {
  interface IpcEventChannels {
    'data:changed': { keys: string[] }
  }
}

export {}
