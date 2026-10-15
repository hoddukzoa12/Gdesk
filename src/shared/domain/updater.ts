/**
 * 자동 업데이트 방식.
 * - `auto`: 뒤에서 내려받고 다음 재시작 때 적용한다(윈도우, 리눅스 AppImage, 서명된 맥).
 * - `notify`: 새 버전 확인만 하고 다운로드 페이지를 연다(서명 안 된 맥, 리눅스 deb).
 * - `off`: 업데이트 기능을 쓰지 않는다(개발·테스트 실행, 저장소 미설정).
 */
export type UpdaterMode = 'auto' | 'notify' | 'off'

/** 업데이트 상태. */
export type UpdaterState =
  /** 개발·테스트 실행이라 꺼져 있다. */
  | 'disabled'
  /** 빌드에 저장소(GDESK_REPO)가 없어 확인할 수 없다. */
  | 'unavailable'
  /** 아직 확인하지 않았다. */
  | 'idle'
  | 'checking'
  /** 최신 버전이다. */
  | 'up_to_date'
  /** 새 버전이 있다(notify 방식: 다운로드 페이지를 연다). */
  | 'available'
  /** 새 버전을 내려받는 중(auto 방식). */
  | 'downloading'
  /** 내려받기 끝. 재시작하면 적용된다(auto 방식). */
  | 'ready'
  | 'error'

export interface UpdaterStatus {
  state: UpdaterState
  mode: UpdaterMode
  /** 지금 실행 중인 버전. */
  currentVersion: string
  /** 새 버전(available·downloading·ready 일 때). */
  version: string | null
  /** 내려받기 진행률 0–100 (downloading 일 때). */
  progress: number | null
  /** 마지막으로 확인을 마친 시각(ms). */
  checkedAt: number | null
  /** 오류 요약(error 일 때). */
  error: string | null
}
