const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const driverRoutes = require('./routes/driverRoutes')

describe('driver route location validation helpers', () => {
  it('accepts resolved coordinates for route creation', () => {
    const error = driverRoutes.validateRouteLocations('POST', {
      origin: { lat: 10.77, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
    })

    assert.equal(error, null)
  })

  it('rejects POST requests without both origin and destination', () => {
    const error = driverRoutes.validateRouteLocations('POST', {
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
    })

    assert.equal(
      error,
      'Validation Error: Origin and destination are required',
    )
  })

  it('rejects non-finite coordinates', () => {
    const error = driverRoutes.validateRouteLocations('POST', {
      origin: { lat: Number.NaN, lng: 106.7, label: 'Q1' },
      destination: { lat: 10.85, lng: 106.75, label: 'TD' },
    })

    assert.equal(
      error,
      'Validation Error: Unresolved exact-point coordinates are not allowed',
    )
  })

  it('rejects the 0/0 unresolved sentinel on update', () => {
    const error = driverRoutes.validateRouteLocations('PUT', {
      destination: { lat: 0, lng: 0, label: 'TD' },
    })

    assert.equal(
      error,
      'Validation Error: Unresolved exact-point coordinates are not allowed',
    )
  })
})
