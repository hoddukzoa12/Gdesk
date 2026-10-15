/**
 * 오류 보고서에서 개인 정보를 지우는 순수 함수(spec §9, 불변 조건: 토큰은 오류 보고에 나오지 않는다).
 *
 * 지우는 것(이 순서로):
 * 1. 토큰: 알고 있는 비밀 값, `ghp_`·`gho_`·`ghu_`·`ghs_`·`ghr_`·`github_pat_` 모양 → `<token>`
 * 2. 폴더 경로: 홈 폴더, `/Users/<x>`·`/home/<x>`·`C:\Users\<x>` → `~`
 * 3. GitHub 주소 안의 `소유자/이름` → `<owner>/<repo>`
 * 4. 캐시가 아는 저장소 전체 이름 → `<repo>`, 로그인 사용자 → `<user>`, 소유자 → `<owner>`,
 *    저장소 이름만(`repoNames`) → `<repo>`
 *
 * 지나치게 지우는 쪽이 새는 쪽보다 낫다. 그래도 이름은 단어 경계에서만 바꿔 `bob` 이 `bobsled` 를 망가뜨리지 않는다.
 */

export interface ScrubContext {
  /** 사용자 홈 폴더(os.homedir()) */
  homeDir?: string | null
  /** 로그인한 사용자 이름 */
  login?: string | null
  /** 캐시가 아는 저장소 `소유자/이름` */
  repos?: readonly string[]
  /** 캐시가 아는 소유자(사용자·조직) 이름 */
  owners?: readonly string[]
  /**
   * 소유자 없이 이름만으로도 지울 저장소 이름(내 저장소). 스타한 유명 저장소(react, electron 등)까지
   * 넣으면 스택의 `node_modules/react` 같은 부분이 모두 지워져 보고서가 쓸모없어진다.
   */
  repoNames?: readonly string[]
  /** 모양과 관계없이 그대로 지울 비밀 값(현재 토큰 등) */
  secrets?: readonly string[]
}

const TOKEN = '<token>'
const HOME = '~'

/** 토큰 모양. 앞 경계를 요구하지 않는다(`token%3Dghp_…` 같은 경우도 지우도록). */
const TOKEN_PATTERN = /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g

/** 경로 조각 하나(사용자 폴더 이름). 구분자·공백·따옴표·괄호에서 멈춘다. */
const SEGMENT = '[^\\\\/\\s:\'"`()\\[\\]<>]+'
const POSIX_USER_DIR = new RegExp(`/(?:Users|home)/${SEGMENT}`, 'g')
const WINDOWS_USER_DIR = new RegExp(
  `[A-Za-z]:[\\\\/]+(?:Users|Documents and Settings)[\\\\/]+${SEGMENT}`,
  'gi'
)

/** github.com·api.github.com·raw.githubusercontent.com 주소의 소유자/이름 */
const GITHUB_URL =
  /((?:[A-Za-z0-9-]+\.)*github(?:usercontent)?\.com\/)((?:repos|users|orgs)\/)?([A-Za-z0-9-]+)(?:\/([A-Za-z0-9._-]+))?/gi

/** GitHub 이름에 쓰이는 글자. 앞뒤가 이 글자(또는 자리표시자 괄호)면 단어 경계가 아니다. */
const NAME_BEFORE = '(?<![A-Za-z0-9_<-])'
const NAME_AFTER = '(?![A-Za-z0-9_>-])'

/** 저장소 이름만 지울 때의 최소 길이. 너무 짧은 이름은 일반 단어를 망가뜨린다. */
const MIN_BARE_REPO_NAME = 3

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function clean(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  // 긴 것부터 바꿔야 `acme/app-x` 가 `acme/app` 에 먼저 먹히지 않는다
  return out.sort((a, b) => b.length - a.length)
}

function replaceExact(text: string, values: readonly string[], replacement: string): string {
  let out = text
  for (const value of values) {
    out = out.replace(new RegExp(escapeRegExp(value), 'gi'), replacement)
  }
  return out
}

function replaceNames(text: string, names: readonly string[], replacement: string): string {
  let out = text
  for (const name of names) {
    out = out.replace(
      new RegExp(`${NAME_BEFORE}${escapeRegExp(name)}${NAME_AFTER}`, 'gi'),
      replacement
    )
  }
  return out
}

function homeVariants(home: string | null | undefined): string[] {
  const value = home?.trim().replace(/[\\/]+$/, '')
  // '/' 나 'C:' 같은 뿌리는 모든 경로를 망가뜨리므로 쓰지 않는다
  if (!value || value.length < 3) return []
  return clean([
    value,
    value.replace(/\\/g, '/'),
    value.replace(/\//g, '\\'),
    value.replace(/\\/g, '\\\\')
  ])
}

export function scrubText(text: string, ctx: ScrubContext = {}): string {
  let out = text

  // 1. 토큰
  out = replaceExact(out, clean(ctx.secrets ?? []), TOKEN)
  out = out.replace(TOKEN_PATTERN, TOKEN)

  // 2. 폴더 경로
  out = replaceExact(out, homeVariants(ctx.homeDir), HOME)
  out = out.replace(WINDOWS_USER_DIR, HOME)
  out = out.replace(POSIX_USER_DIR, HOME)

  // 3. GitHub 주소
  out = out.replace(
    GITHUB_URL,
    (_m, host: string, kind: string | undefined, _owner: string, name: string | undefined) =>
      `${host}${kind ?? ''}<owner>${name ? '/<repo>' : ''}`
  )

  // 4. 캐시가 아는 이름
  const repos = clean((ctx.repos ?? []).filter((r) => r.includes('/')))
  out = replaceNames(out, repos, '<repo>')
  out = replaceNames(out, clean([ctx.login]), '<user>')
  out = replaceNames(out, clean(ctx.owners ?? []), '<owner>')
  const bareNames = clean(ctx.repoNames ?? []).filter((n) => n.length >= MIN_BARE_REPO_NAME)
  out = replaceNames(out, bareNames, '<repo>')

  return out
}
