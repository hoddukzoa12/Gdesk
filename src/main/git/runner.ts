// 내장 git(dugite) 명령 실행기. 환경 변수 주입, 취소, stderr 줄 단위 전달을 맡는다.
// 이 모듈은 저장소 동작(클론 등)을 모른다. 이후 fetch/checkout 도 이 위에 올린다.
import type { ChildProcess } from 'node:child_process'
import { exec as dugiteExec } from 'dugite'
import type { IGitStringExecutionOptions, IGitStringResult } from 'dugite'

/** git 을 실행하는 함수. 테스트에서 인자·환경 변수를 기록하거나 가짜로 바꾸려고 주입한다. */
export type GitExec = (
  args: string[],
  path: string,
  options?: IGitStringExecutionOptions
) => Promise<IGitStringResult>

export interface GitRunOptions {
  /** 이 명령의 자식 프로세스에만 더해지는 환경 변수. */
  env?: Record<string, string>
  /** 신호가 오면 git 프로세스를 끝내고 { kind: 'cancelled' } 를 돌려준다. */
  signal?: AbortSignal
  /** stderr 를 줄 단위로(\r, \n 모두 줄 끝으로 보고) 받는다. 진행률 표시용. */
  onStderrLine?: (line: string) => void
  exec?: GitExec
}

export type GitRunResult =
  { kind: 'done'; exitCode: number; stdout: string; stderr: string } | { kind: 'cancelled' }

/** 취소 뒤 프로세스가 스스로 끝나기를 기다리는 시간. 넘으면 SIGKILL. */
const KILL_GRACE_MS = 5_000
/** SIGKILL 뒤에도 종료 알림이 없을 때 더 기다리지 않는 시간. */
const KILL_GIVE_UP_MS = 2_000

/**
 * git 명령 하나를 실행한다. cwd 는 존재하는 폴더여야 한다.
 * 실행 파일을 띄우지 못하면(예: ENOENT) 예외를 던진다. 종료 코드가 0 이 아니어도 예외가 아니다.
 */
export async function runGit(
  args: string[],
  cwd: string,
  options: GitRunOptions = {}
): Promise<GitRunResult> {
  const { env, signal, onStderrLine, exec = dugiteExec } = options
  if (signal?.aborted) return { kind: 'cancelled' }

  const splitter = onStderrLine ? createLineSplitter(onStderrLine) : null
  let child: ChildProcess | undefined
  let exited: Promise<void> = Promise.resolve()

  try {
    const result = await exec(args, cwd, {
      env,
      signal,
      processCallback: (cp) => {
        child = cp
        exited = new Promise<void>((resolve) => {
          if (cp.exitCode !== null || cp.signalCode !== null) resolve()
          else cp.once('exit', () => resolve())
        })
        cp.stderr?.on('data', (chunk: Buffer | string) => splitter?.push(chunk.toString()))
      }
    })
    splitter?.flush()
    if (signal?.aborted) {
      await waitForExit(child, exited)
      return { kind: 'cancelled' }
    }
    return { kind: 'done', exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    splitter?.flush()
    if (signal?.aborted) {
      // execFile 는 취소 즉시 콜백을 부르지만 git 은 아직 정리 중일 수 있다.
      // 폴더를 지우기 전에 프로세스가 실제로 끝날 때까지 기다린다.
      await waitForExit(child, exited)
      return { kind: 'cancelled' }
    }
    throw error
  }
}

async function waitForExit(child: ChildProcess | undefined, exited: Promise<void>): Promise<void> {
  if (!child) return
  const timeout = (ms: number) =>
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms).unref())
  if (
    (await Promise.race([exited.then(() => 'exited' as const), timeout(KILL_GRACE_MS)])) ===
    'exited'
  ) {
    return
  }
  child.kill('SIGKILL')
  await Promise.race([exited, timeout(KILL_GIVE_UP_MS)])
}

/** 조각난 출력을 이어 붙여 \r 또는 \n 으로 끝나는 줄마다 onLine 을 부른다. 빈 줄은 건너뛴다. */
export function createLineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void
  flush: () => void
} {
  let buffer = ''
  const emit = (line: string) => {
    if (line.trim() !== '') onLine(line)
  }
  return {
    push(chunk) {
      buffer += chunk
      const parts = buffer.split(/\r\n|\r|\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) emit(part)
    },
    flush() {
      const rest = buffer
      buffer = ''
      emit(rest)
    }
  }
}

export interface GitProgress {
  /** git 이 출력한 단계 이름. 예: "Receiving objects" */
  phase: string
  /** 0~100 */
  percent: number
}

const PROGRESS_LINE = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/

/** "Receiving objects:  45% (45/100)" 같은 진행률 줄을 해석한다. 진행률 줄이 아니면 null. */
export function parseProgressLine(line: string): GitProgress | null {
  const match = PROGRESS_LINE.exec(line.trim())
  if (!match) return null
  const [, phase, percent] = match
  if (phase === undefined || percent === undefined) return null
  const value = Number(percent)
  if (value > 100) return null
  return { phase, percent: value }
}
