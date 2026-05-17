import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpError } from '../src/http-error'
import { requireBodyString, requireParam } from '../src/shared/requestHelpers'

describe('request helpers', () => {
  describe('requireBodyString', () => {
    it('rejects blank strings', () => {
      assert.throws(
        () => requireBodyString('   ', 'driverId'),
        (error: unknown) =>
          error instanceof HttpError &&
          error.statusCode === 400 &&
          error.message === 'Wallet validation error: driverId is required',
      )
    })

    it('returns trimmed strings', () => {
      assert.equal(requireBodyString('  driver-1 \n', 'driverId'), 'driver-1')
    })
  })

  describe('requireParam', () => {
    it('preserves falsy assertion semantics and messages', () => {
      assert.throws(
        () => requireParam('', 'custom field is required'),
        (error: unknown) =>
          error instanceof HttpError &&
          error.statusCode === 400 &&
          error.message === 'custom field is required',
      )
    })
  })
})
