// 업데이트 방식 결정(순수 함수). electron·빌드 상수에 의존하지 않아 단위 테스트로 표 전체를 검사한다.
import type { UpdaterMode, UpdaterState } from '@shared/domain/updater'

/** 리눅스 설치 형식. AppImage 만 제자리 업데이트가 된다. */
export type LinuxPackage = 'appimage' | 'deb' | 'unknown'

export interface UpdateModeInput {
  /** `process.platform` */
  platform: string
  /** 설치 파일로 패키징된 실행인지(`app.isPackaged`). 개발 실행이면 false. */
  packaged: boolean
  /** 맥 빌드가 서명됐는지(빌드 상수 `__GDESK_MAC_SIGNED__`). */
  macSigned: boolean
  /** 빌드에 올바른 저장소(`GDESK_REPO`)가 있는지. */
  repoConfigured: boolean
  /** 화면 테스트 모드인지. */
  testMode: boolean
  /** 리눅스 설치 형식. 다른 OS 에서는 무시한다. */
  linuxPackage: LinuxPackage
}

export interface UpdateModeDecision {
  mode: UpdaterMode
  initialState: Extract<UpdaterState, 'disabled' | 'unavailable' | 'idle'>
}

/**
 * 플랫폼별 업데이트 방식.
 *
 * | 조건                                   | 방식                    |
 * |----------------------------------------|-------------------------|
 * | 개발 실행, 테스트 모드                  | off (disabled)          |
 * | 저장소 미설정                           | off (unavailable)       |
 * | 윈도우, 리눅스 AppImage, 서명된 맥      | auto                    |
 * | 서명 안 된 맥, 리눅스 deb·그 밖         | notify                  |
 */
export function decideUpdateMode(input: UpdateModeInput): UpdateModeDecision {
  if (!input.packaged || input.testMode) return { mode: 'off', initialState: 'disabled' }
  if (!input.repoConfigured) return { mode: 'off', initialState: 'unavailable' }

  const autoCapable =
    input.platform === 'win32' ||
    (input.platform === 'darwin' && input.macSigned) ||
    (input.platform === 'linux' && input.linuxPackage === 'appimage')

  return { mode: autoCapable ? 'auto' : 'notify', initialState: 'idle' }
}

/**
 * 리눅스 설치 형식 판별. AppImage 는 실행 시 `APPIMAGE` 환경 변수가 있고,
 * deb 는 electron-builder 가 `resources/package-type` 파일에 `deb` 를 적는다.
 */
export function detectLinuxPackage(input: {
  appImagePath: string | undefined
  packageType: string | null
}): LinuxPackage {
  if (input.appImagePath) return 'appimage'
  if (input.packageType?.trim() === 'deb') return 'deb'
  return 'unknown'
}

export interface RepoRef {
  owner: string
  repo: string
}

const NAME = /^[A-Za-z0-9_.-]+$/

/** `소유자/이름` 을 나눈다. 형식이 틀리면 null(업데이트를 쓰지 않는다). */
export function parseRepo(raw: string): RepoRef | null {
  const parts = raw.trim().split('/')
  if (parts.length !== 2) return null
  const [owner, repo] = parts as [string, string]
  if (!NAME.test(owner) || !NAME.test(repo)) return null
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null
  return { owner, repo }
}

/** 새 버전을 받는 페이지(GitHub Releases 의 최신 릴리스). */
export function releasesPageUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/releases/latest`
}
