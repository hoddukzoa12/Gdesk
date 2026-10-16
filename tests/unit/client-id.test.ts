import { describe, expect, it } from 'vitest'
import { resolveClientId } from '../../build/client-id'

describe('resolveClientId', () => {
  it('환경 변수가 없으면 기본 client ID 를 쓴다', () => {
    expect(resolveClientId({})).toBe('Ov23liGhQ9tQPP7wqESg')
    expect(resolveClientId({ GDESK_GITHUB_CLIENT_ID: undefined })).toBe('Ov23liGhQ9tQPP7wqESg')
  })

  it('환경 변수가 있으면 그 값으로 덮어쓴다', () => {
    expect(resolveClientId({ GDESK_GITHUB_CLIENT_ID: 'gdesk-e2e-client' })).toBe('gdesk-e2e-client')
  })

  it('빈 문자열이면 비운 채로 둔다(브라우저 로그인 꺼짐)', () => {
    expect(resolveClientId({ GDESK_GITHUB_CLIENT_ID: '' })).toBe('')
  })
})
