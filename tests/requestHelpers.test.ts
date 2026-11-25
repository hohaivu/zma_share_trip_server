import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpError } from '../src/http-error'
import { requireParam } from '../src/shared/requestHelpers'

describe('request helpers', () => {
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
