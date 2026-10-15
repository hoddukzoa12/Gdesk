import { useSyncExternalStore } from 'react'

/** 클론 대화상자를 여는 요청(명령 팔레트 등 다른 기능도 requestClone 으로 부른다) */
export interface CloneTarget {
  repoId: number
  owner: string
  name: string
}

export interface CloneDialogState {
  /** 열린 요청. null 이면 닫힘 */
  target: CloneTarget | null
  /** 열 때마다 늘어난다(같은 저장소를 다시 열어도 새로 시작) */
  seq: number
}

let state: CloneDialogState = { target: null, seq: 0 }
const listeners = new Set<() => void>()

function setState(next: CloneDialogState): void {
  state = next
  for (const listener of listeners) listener()
}

/** 클론 대화상자를 연다. 이미 열려 있으면 새 저장소로 바꿔 처음부터 시작한다. */
export function requestClone(target: CloneTarget): void {
  setState({
    target: { repoId: target.repoId, owner: target.owner, name: target.name },
    seq: state.seq + 1
  })
}

/** 클론 대화상자를 닫는다(진행 중인 클론은 대화상자가 먼저 취소한다). */
export function closeCloneDialog(): void {
  if (state.target === null) return
  setState({ target: null, seq: state.seq })
}

export function getCloneDialogState(): CloneDialogState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCloneDialogState(): CloneDialogState {
  return useSyncExternalStore(subscribe, getCloneDialogState, getCloneDialogState)
}
