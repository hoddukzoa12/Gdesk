import { describe, expect, it } from 'vitest'
import { scrubText, type ScrubContext } from './scrub'

const ctx: ScrubContext = {
  homeDir: '/Users/alice',
  login: 'octo-alice',
  repos: ['acme-corp/secret-app', 'octo-alice/dotfiles', 'bob/stars.io'],
  owners: ['acme-corp', 'octo-alice', 'bob'],
  repoNames: ['secret-app', 'dotfiles', 'stars.io'],
  secrets: ['plain-secret-value-123']
}

const TOKEN_TAIL = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'

describe('scrubText', () => {
  it.each<[string, string, string, ScrubContext?]>([
    // 경로
    ['macOS 홈 폴더', 'at load (/Users/alice/work/x.js:1:2)', 'at load (~/work/x.js:1:2)'],
    ['다른 macOS 사용자 폴더', 'open /Users/carol/notes.txt failed', 'open ~/notes.txt failed'],
    [
      '리눅스 홈 폴더',
      "ENOENT: no such file, open '/home/dave/.config/x'",
      "ENOENT: no such file, open '~/.config/x'"
    ],
    [
      '윈도우 사용자 폴더',
      'at f (C:\\Users\\Erin\\AppData\\Local\\gdesk\\a.js:3:4)',
      'at f (~\\AppData\\Local\\gdesk\\a.js:3:4)'
    ],
    [
      '윈도우 사용자 폴더(슬래시·file URL)',
      'at file:///c:/Users/Erin/app/a.js:1:1',
      'at file:///~/app/a.js:1:1'
    ],
    [
      '표준이 아닌 홈 폴더',
      'cannot read /srv/profiles/frank/cfg.json',
      'cannot read ~/cfg.json',
      { homeDir: '/srv/profiles/frank' }
    ],
    [
      '윈도우 홈 폴더(정확히 일치)',
      'at D:\\Profiles\\gina\\x.js and D:/Profiles/gina/y.js',
      'at ~\\x.js and ~/y.js',
      { homeDir: 'D:\\Profiles\\gina' }
    ],
    // 저장소·사용자
    ['알고 있는 저장소 전체 이름', 'Failed to sync acme-corp/secret-app', 'Failed to sync <repo>'],
    ['저장소 이름 대소문자 무시', 'repo ACME-CORP/Secret-App gone', 'repo <repo> gone'],
    ['저장소 이름만', "Cannot find 'secret-app' in list", "Cannot find '<repo>' in list"],
    ['소유자 이름만', 'org acme-corp is restricted', 'org <owner> is restricted'],
    ['로그인 사용자 이름', 'user octo-alice not allowed', 'user <user> not allowed'],
    ['@멘션 형태의 사용자 이름', 'mentioned @octo-alice', 'mentioned @<user>'],
    ['점이 들어간 저장소 이름', 'bob/stars.io is archived', '<repo> is archived'],
    // 토큰
    ['ghp_ 토큰', `token ghp_${TOKEN_TAIL} invalid`, 'token <token> invalid'],
    ['gho_ 토큰', `Bearer gho_${TOKEN_TAIL}`, 'Bearer <token>'],
    ['ghu_ 토큰', `x=ghu_${TOKEN_TAIL}`, 'x=<token>'],
    ['ghs_ 토큰', `"ghs_${TOKEN_TAIL}"`, '"<token>"'],
    ['ghr_ 토큰', `refresh ghr_${TOKEN_TAIL}.`, 'refresh <token>.'],
    [
      'github_pat_ 토큰',
      `auth github_pat_11ABCDEFG0_${TOKEN_TAIL}${TOKEN_TAIL} failed`,
      'auth <token> failed'
    ],
    ['알고 있는 비밀 값', 'value plain-secret-value-123 leaked', 'value <token> leaked'],
    // GitHub 주소
    [
      'github.com 저장소 주소',
      'GET https://github.com/someone/private-thing/pulls failed',
      'GET https://github.com/<owner>/<repo>/pulls failed'
    ],
    [
      'API 주소',
      'GET https://api.github.com/repos/someone/private-thing/issues 404',
      'GET https://api.github.com/repos/<owner>/<repo>/issues 404'
    ],
    ['사용자 주소', 'see https://github.com/someone', 'see https://github.com/<owner>'],
    // 바뀌지 않아야 하는 것
    [
      '민감하지 않은 메시지',
      "TypeError: Cannot read properties of undefined (reading 'map')\n    at render (app.asar/out/renderer/index.js:10:5)",
      "TypeError: Cannot read properties of undefined (reading 'map')\n    at render (app.asar/out/renderer/index.js:10:5)"
    ]
  ])('%s', (_name, input, expected, override) => {
    expect(scrubText(input, override ?? ctx)).toBe(expected)
  })

  it('긴 단어 안의 짧은 이름은 건드리지 않는다', () => {
    expect(scrubText('bobsled and bob-cat', ctx)).toBe('bobsled and bob-cat')
  })

  it('바꾼 자리표시자를 다시 바꾸지 않는다', () => {
    const out = scrubText('user owner and repo', { login: 'owner', repoNames: ['repo'] })
    expect(out).toBe('user <user> and <repo>')
  })

  it('이름만 지우는 것은 repoNames 에 있는 것뿐이다(스타한 유명 저장소 이름은 남긴다)', () => {
    const out = scrubText('at node_modules/react/index.js via facebook/react', {
      repos: ['facebook/react'],
      repoNames: []
    })
    expect(out).toBe('at node_modules/react/index.js via <repo>')
  })

  it('짧은 저장소 이름(2자 이하)은 이름만으로는 지우지 않는다', () => {
    expect(scrubText('a ui b', { repoNames: ['ui'] })).toBe('a ui b')
  })

  it('빈 문맥에서도 경로와 토큰은 지운다', () => {
    expect(scrubText(`/home/zed/a ghp_${TOKEN_TAIL}`)).toBe('~/a <token>')
  })

  it('너무 짧은 홈 폴더(/)는 무시한다', () => {
    expect(scrubText('/usr/lib/x', { homeDir: '/' })).toBe('/usr/lib/x')
  })
})
