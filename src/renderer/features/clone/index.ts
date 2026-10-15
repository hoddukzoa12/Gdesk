// 클론·열기 기능의 공개 API. 다른 기능(명령 팔레트 등)은 여기서만 가져다 쓴다.
//
//   requestClone({ repoId, owner, name })  // 클론 대화상자를 연다
//
// 대상 경로는 기본 `<설정의 클론 기본 폴더>/<name>`. 대화상자의 "변경…"으로 고른 폴더는 부모 폴더로 쓰여
// `<고른 폴더>/<name>` 에 클론한다.
export { closeCloneDialog, requestClone, type CloneTarget } from './store'
export { CloneOpenMenu, type CloneOpenMenuProps } from './CloneMenu'
