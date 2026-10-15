/** 고정한 저장소. 저장소 이름이 아니라 GitHub 숫자 저장소 ID 로 기억한다(spec 3). */
export interface Pin {
  /** GitHub 숫자 저장소 ID */
  repoId: number
  /** 0 부터 시작하는 순서 */
  position: number
}
