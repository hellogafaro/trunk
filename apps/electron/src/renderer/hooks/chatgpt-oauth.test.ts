import { describe, expect, it } from 'bun:test'
import { parseChatGptCallbackUrl } from './chatgpt-oauth'

describe('parseChatGptCallbackUrl', () => {
  it('extracts a matching localhost callback', () => {
    expect(parseChatGptCallbackUrl(
      'http://localhost:1455/auth/callback?code=abc123&state=state123',
      'state123',
    )).toEqual({ code: 'abc123', state: 'state123' })
  })

  it('rejects callbacks for another origin', () => {
    expect(() => parseChatGptCallbackUrl(
      'https://example.com/auth/callback?code=abc123&state=state123',
      'state123',
    )).toThrow('must start with http://localhost:1455/auth/callback')
  })

  it('rejects a mismatched state', () => {
    expect(() => parseChatGptCallbackUrl(
      'http://localhost:1455/auth/callback?code=abc123&state=wrong',
      'state123',
    )).toThrow('OAuth state mismatch')
  })

  it('surfaces provider errors', () => {
    expect(() => parseChatGptCallbackUrl(
      'http://localhost:1455/auth/callback?error=access_denied&error_description=Cancelled&state=state123',
      'state123',
    )).toThrow('Cancelled')
  })
})
