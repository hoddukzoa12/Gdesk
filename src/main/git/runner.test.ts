import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createLineSplitter, parseProgressLine, runGit } from './runner'

describe('createLineSplitter', () => {
  it('\\r 과 \\n 모두에서 줄을 나누고 조각난 입력을 이어 붙인다', () => {
    const lines: string[] = []
    const splitter = createLineSplitter((l) => lines.push(l))
    splitter.push('Receiving objects:  10% (1/10)\rReceiving obj')
    splitter.push('ects:  20% (2/10)\r\n')
    splitter.push('done\nlast')
    splitter.flush()
    expect(lines).toEqual([
      'Receiving objects:  10% (1/10)',
      'Receiving objects:  20% (2/10)',
      'done',
      'last'
    ])
  })
})

describe('parseProgressLine', () => {
  it.each([
    ['Receiving objects:  45% (45/100), 1.20 MiB | 1.00 MiB/s', 'Receiving objects', 45],
    ['remote: Counting objects: 100% (3/3), done.        ', 'Counting objects', 100],
    ['remote: Compressing objects:   7% (1/14)', 'Compressing objects', 7],
    ['Resolving deltas:  12% (3/25)', 'Resolving deltas', 12],
    ['Updating files: 100% (10/10), done.', 'Updating files', 100]
  ])('%s', (line, phase, percent) => {
    expect(parseProgressLine(line)).toEqual({ phase, percent })
  })

  it.each([
    "Cloning into 'x'...",
    'remote: Enumerating objects: 3, done.',
    'fatal: repository not found',
    ''
  ])('%s → null', (line) => {
    expect(parseProgressLine(line)).toBeNull()
  })
})

describe('runGit', () => {
  it('종료 코드와 출력을 돌려주고 stderr 를 줄 단위로 흘려 준다', async () => {
    const lines: string[] = []
    const result = await runGit(['definitely-not-a-git-command'], tmpdir(), {
      onStderrLine: (l) => lines.push(l)
    })
    expect(result.kind).toBe('done')
    if (result.kind !== 'done') return
    expect(result.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('definitely-not-a-git-command')
  })

  it('환경 변수를 그 명령에만 넣는다', async () => {
    const result = await runGit(['config', '--get', 'gdesk.probe'], tmpdir(), {
      env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'gdesk.probe', GIT_CONFIG_VALUE_0: 'yes' }
    })
    expect(result).toMatchObject({ kind: 'done', exitCode: 0 })
    if (result.kind === 'done') expect(result.stdout.trim()).toBe('yes')
    expect(process.env.GIT_CONFIG_KEY_0).toBeUndefined()
  })

  it('이미 취소된 신호면 실행하지 않고 cancelled', async () => {
    let called = false
    const controller = new AbortController()
    controller.abort()
    const result = await runGit(['--version'], tmpdir(), {
      signal: controller.signal,
      exec: async () => {
        called = true
        return { stdout: '', stderr: '', exitCode: 0 }
      }
    })
    expect(result).toEqual({ kind: 'cancelled' })
    expect(called).toBe(false)
  })
})
