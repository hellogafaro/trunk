import { describe, expect, it } from 'bun:test'
import { createRequestId } from './client'

describe('createRequestId', () => {
  it('uses randomUUID when the secure-context API is available', () => {
    const expected = '11111111-1111-4111-8111-111111111111'
    const cryptoApi = {
      randomUUID: () => expected,
      getRandomValues: (values: Uint8Array) => values,
    }

    expect(createRequestId(cryptoApi)).toBe(expected)
  })

  it('creates an RFC 4122 v4 UUID when randomUUID is unavailable', () => {
    const cryptoApi = {
      getRandomValues: (values: Uint8Array) => {
        values.fill(0xaa)
        return values
      },
    }

    expect(createRequestId(cryptoApi)).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
  })
})
