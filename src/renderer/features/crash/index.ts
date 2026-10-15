// 앱 틀이 본문을 감쌀 때 쓰는 오류 경계와 화면 오류 감시 도구.
export { CrashBoundary, type CrashBoundaryProps } from './CrashBoundary'
export { installCrashListeners, reportRendererError, toRendererError } from './capture'
