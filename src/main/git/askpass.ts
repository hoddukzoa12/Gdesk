// GIT_ASKPASS 임시 도우미. 토큰은 파일에 쓰지 않고, 자식 프로세스 환경 변수에서 읽어 출력한다.
// 도우미 파일은 git 명령 하나 동안만 존재하고 끝나면 지운다.
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** askpass 도우미가 토큰을 읽는 환경 변수 이름. 그 git 명령의 자식 프로세스에만 넣는다. */
export const ASKPASS_TOKEN_ENV = 'GDESK_GIT_TOKEN'
/** GitHub 앱/OAuth 토큰으로 HTTPS 인증할 때 쓰는 사용자 이름. */
export const ASKPASS_USERNAME = 'x-access-token'

/**
 * OS 별 도우미 스크립트. git 은 도우미를 `도우미 "<질문>"` 으로 부르고 stdout 첫 줄을 답으로 쓴다.
 * 질문이 Username 으로 시작하면 사용자 이름, 그 밖에는(Password) 토큰을 출력한다.
 */
export function askpassScript(platform: NodeJS.Platform): { content: string; extension: string } {
  if (platform === 'win32') {
    return {
      extension: '.bat',
      content: [
        '@echo off',
        'setlocal EnableDelayedExpansion',
        'set "GDESK_ASKPASS_PROMPT=%~1"',
        'if /i "!GDESK_ASKPASS_PROMPT:~0,8!"=="Username" (',
        `  echo ${ASKPASS_USERNAME}`,
        ') else (',
        `  echo(!${ASKPASS_TOKEN_ENV}!`,
        ')',
        ''
      ].join('\r\n')
    }
  }
  return {
    extension: '.sh',
    content: [
      '#!/bin/sh',
      'case "$1" in',
      `  Username*) printf '%s\\n' '${ASKPASS_USERNAME}' ;;`,
      `  *) printf '%s\\n' "$${ASKPASS_TOKEN_ENV}" ;;`,
      'esac',
      ''
    ].join('\n')
  }
}

export interface AskpassHelper {
  /** 도우미가 든 임시 폴더 */
  dir: string
  /** 도우미 실행 파일 경로 */
  path: string
  /** 그 git 명령에만 넣을 환경 변수(GIT_ASKPASS, 토큰, GIT_TERMINAL_PROMPT=0) */
  env: Record<string, string>
  /** 임시 폴더를 지운다. 여러 번 불러도 된다. */
  dispose: () => Promise<void>
}

/** 임시 폴더에 askpass 도우미를 만든다. 사용 뒤 반드시 dispose 한다. */
export async function createAskpass(
  token: string,
  platform: NodeJS.Platform = process.platform
): Promise<AskpassHelper> {
  const dir = await mkdtemp(join(tmpdir(), 'gdesk-askpass-'))
  const dispose = () => rm(dir, { recursive: true, force: true, maxRetries: 3 })
  try {
    const { content, extension } = askpassScript(platform)
    const path = join(dir, `askpass${extension}`)
    await writeFile(path, content, { mode: 0o700 })
    // umask 와 무관하게 실행 권한을 보장한다(Windows 에서는 의미 없음).
    await chmod(path, 0o700)
    return {
      dir,
      path,
      env: { GIT_ASKPASS: path, [ASKPASS_TOKEN_ENV]: token, GIT_TERMINAL_PROMPT: '0' },
      dispose
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
