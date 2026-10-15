import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { exec } from 'dugite'
import { describe, expect, it } from 'vitest'
import { ASKPASS_TOKEN_ENV, askpassScript, createAskpass } from './askpass'

const execFileAsync = promisify(execFile)
const TOKEN = 'ghp_askpassTEST0123456789abcdef'

/** 현재 OS 에서 askpass 도우미를 git 이 부르는 방식(인자 하나 = 질문)으로 실행한다. */
async function runHelper(path: string, prompt: string, env: Record<string, string>) {
  const fullEnv = { ...process.env, ...env }
  const { stdout } =
    process.platform === 'win32'
      ? await execFileAsync('cmd.exe', ['/d', '/c', path, prompt], { env: fullEnv })
      : await execFileAsync(path, [prompt], { env: fullEnv })
  return stdout.trim()
}

describe('askpassScript', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    '%s 스크립트에는 토큰이 아니라 변수 이름만 있다',
    (p) => {
      const { content, extension } = askpassScript(p)
      expect(content).toContain(ASKPASS_TOKEN_ENV)
      expect(content).toContain('x-access-token')
      expect(extension).toBe(p === 'win32' ? '.bat' : '.sh')
    }
  )
})

describe('createAskpass', () => {
  it('사용자 이름은 x-access-token, 비밀번호는 환경 변수의 토큰을 출력한다', async () => {
    const helper = await createAskpass(TOKEN)
    try {
      const script = await readFile(helper.path, 'utf8')
      expect(script).not.toContain(TOKEN)
      expect(helper.env[ASKPASS_TOKEN_ENV]).toBe(TOKEN)
      expect(helper.env.GIT_ASKPASS).toBe(helper.path)
      expect(helper.env.GIT_TERMINAL_PROMPT).toBe('0')

      await expect(
        runHelper(helper.path, "Username for 'https://github.com': ", helper.env)
      ).resolves.toBe('x-access-token')
      await expect(
        runHelper(helper.path, "Password for 'https://x-access-token@github.com': ", helper.env)
      ).resolves.toBe(TOKEN)
    } finally {
      await helper.dispose()
    }
    expect(existsSync(helper.path)).toBe(false)
    expect(existsSync(helper.dir)).toBe(false)
  })

  it('내장 git 이 credential.helper 를 비운 채로 도우미에서 자격 증명을 받는다', async () => {
    const helper = await createAskpass(TOKEN)
    try {
      const result = await exec(['-c', 'credential.helper=', 'credential', 'fill'], helper.dir, {
        env: helper.env,
        stdin: 'protocol=https\nhost=github.com\n\n'
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('username=x-access-token')
      expect(result.stdout).toContain(`password=${TOKEN}`)
    } finally {
      await helper.dispose()
    }
    expect(existsSync(helper.dir)).toBe(false)
  })

  it('dispose 는 여러 번 불러도 안전하다', async () => {
    const helper = await createAskpass(TOKEN)
    await helper.dispose()
    await expect(helper.dispose()).resolves.toBeUndefined()
  })
})
