/**
 * 상한이 있는 목록 한 쪽. 수치는 상한에 잘리지 않은 전체 개수다.
 * complete 가 false 면 GitHub 에 더 있으므로 화면은 "GitHub 에서 더 보기"를 보여 줄 수 있다.
 */
export interface ListPage<T> {
  items: T[]
  /** 전체 개수(GitHub totalCount·검색 issueCount 기준). 모르면 받은 개수 */
  totalCount: number
  /** 전체를 다 받았는가 */
  complete: boolean
}
