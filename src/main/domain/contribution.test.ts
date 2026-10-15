import { describe, expect, it } from 'vitest'
import {
  hasWriteHolderResponse,
  isUnansweredContribution,
  isWriteHolderAssociation
} from './contribution'

describe('isWriteHolderAssociation', () => {
  it.each([
    ['OWNER', true],
    ['MEMBER', true],
    ['COLLABORATOR', true],
    ['CONTRIBUTOR', false],
    ['FIRST_TIME_CONTRIBUTOR', false],
    ['FIRST_TIMER', false],
    ['NONE', false],
    [null, false]
  ] as const)('%s → %s', (association, expected) => {
    expect(isWriteHolderAssociation(association)).toBe(expected)
  })
})

describe('hasWriteHolderResponse', () => {
  it.each([
    ['응답 없음', [], 0, false],
    [
      '외부인 코멘트만',
      [{ authorAssociation: 'CONTRIBUTOR' }, { authorAssociation: 'NONE' }],
      2,
      false
    ],
    ['소유자 코멘트', [{ authorAssociation: 'NONE' }, { authorAssociation: 'OWNER' }], 2, true],
    ['멤버 리뷰', [{ authorAssociation: 'MEMBER' }], 1, true],
    ['협업자', [{ authorAssociation: 'COLLABORATOR' }], 1, true],
    // 받은 것보다 더 많으면 확인하지 못한 응답이 있을 수 있어 응답한 것으로 본다(보수적)
    ['받지 못한 응답이 있음', [{ authorAssociation: 'NONE' }], 25, true]
  ] as const)('%s', (_name, responses, totalCount, expected) => {
    expect(hasWriteHolderResponse(responses, totalCount)).toBe(expected)
  })
})

describe('isUnansweredContribution (spec §4.2)', () => {
  const base = {
    authorAssociation: 'CONTRIBUTOR',
    authorIsBot: false,
    hasWriteHolderResponse: false
  }

  it.each([
    ['외부 기여자, 응답 없음', base, {}, true],
    ['처음 기여자', { ...base, authorAssociation: 'FIRST_TIME_CONTRIBUTOR' }, {}, true],
    ['연결 없음(NONE)', { ...base, authorAssociation: 'NONE' }, {}, true],
    ['작성자가 소유자', { ...base, authorAssociation: 'OWNER' }, {}, false],
    ['작성자가 멤버', { ...base, authorAssociation: 'MEMBER' }, {}, false],
    ['작성자가 협업자', { ...base, authorAssociation: 'COLLABORATOR' }, {}, false],
    ['쓰기 권한자가 응답함', { ...base, hasWriteHolderResponse: true }, {}, false],
    ['봇 작성(기본 제외)', { ...base, authorIsBot: true }, {}, false],
    ['봇 작성, 제외 끔', { ...base, authorIsBot: true }, { excludeBots: false }, true],
    ['봇 작성, 제외 켬', { ...base, authorIsBot: true }, { excludeBots: true }, false],
    ['연결 정보 없음(null)', { ...base, authorAssociation: null }, {}, true]
  ] as const)('%s', (_name, facts, options, expected) => {
    expect(isUnansweredContribution(facts, options)).toBe(expected)
  })
})
