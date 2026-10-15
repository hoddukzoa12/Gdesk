import { afterEach, describe, expect, it } from 'vitest'
import { closeCloneDialog, getCloneDialogState, requestClone } from './store'

describe('클론 대화상자 상태', () => {
  afterEach(() => closeCloneDialog())

  it('requestClone 이 대화상자를 열고 열 때마다 seq 가 늘어난다', () => {
    expect(getCloneDialogState().target).toBeNull()
    requestClone({ repoId: 101, owner: 'octo', name: 'demo' })
    const first = getCloneDialogState()
    expect(first.target).toEqual({ repoId: 101, owner: 'octo', name: 'demo' })
    requestClone({ repoId: 101, owner: 'octo', name: 'demo' })
    expect(getCloneDialogState().seq).toBe(first.seq + 1)
  })

  it('닫으면 target 이 null', () => {
    requestClone({ repoId: 1, owner: 'a', name: 'b' })
    closeCloneDialog()
    expect(getCloneDialogState().target).toBeNull()
  })

  it('바뀌지 않으면 같은 객체를 돌려준다', () => {
    expect(getCloneDialogState()).toBe(getCloneDialogState())
  })
})
