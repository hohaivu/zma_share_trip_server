import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildNotificationCopy } from './services/notificationService'

// These tests lock the canonical notification copy semantics that the
// route- and group- request services rely on. They are pure assertions
// over `buildNotificationCopy`: no DB or repository calls.

describe('buildNotificationCopy — route request events', () => {
  const metadata = { routeRequestId: 'rr-1', routeId: 'r-1', clientId: 'c-1' }

  it('produces the canonical copy for route_request_received', () => {
    const copy = buildNotificationCopy('route_request_received', metadata)

    assert.equal(copy.type, 'request_received')
    assert.equal(copy.title, 'New request received')
    assert.equal(copy.body, 'You received a new direct request.')
    assert.equal(copy.targetRoute, '/offers')
    assert.equal(copy.deepLink, '/offers')
    assert.equal(copy.requestSource, 'route_request')
    assert.deepEqual(copy.metadata, metadata)
  })

  it('produces the canonical copy for route_request_accepted', () => {
    const copy = buildNotificationCopy('route_request_accepted', metadata)

    assert.equal(copy.type, 'request_accepted')
    assert.equal(copy.title, 'Request accepted')
    assert.equal(copy.body, 'Your request was accepted.')
    assert.equal(copy.targetRoute, '/journeys')
    assert.equal(copy.deepLink, '/journeys')
    assert.equal(copy.requestSource, 'route_request')
    assert.deepEqual(copy.metadata, metadata)
  })

  it('produces the canonical copy for route_request_declined', () => {
    const copy = buildNotificationCopy('route_request_declined', metadata)

    assert.equal(copy.type, 'request_declined')
    assert.equal(copy.title, 'Request declined')
    assert.equal(copy.body, 'Your request was declined.')
    assert.equal(copy.targetRoute, '/offers')
    assert.equal(copy.deepLink, '/offers')
    assert.equal(copy.requestSource, 'route_request')
    assert.deepEqual(copy.metadata, metadata)
  })

  it('produces the canonical copy for route_request_canceled', () => {
    const copy = buildNotificationCopy('route_request_canceled', metadata)

    assert.equal(copy.type, 'request_canceled')
    assert.equal(copy.title, 'Request canceled')
    assert.equal(copy.body, 'A request was canceled.')
    assert.equal(copy.targetRoute, '/offers')
    assert.equal(copy.deepLink, '/offers')
    assert.equal(copy.requestSource, 'route_request')
    assert.deepEqual(copy.metadata, metadata)
  })
})

describe('buildNotificationCopy — group request/offer events', () => {
  const metadata = {
    groupOfferId: 'go-1',
    groupRequestId: 'gr-1',
    driverId: 'd-1',
    routeId: 'r-1',
  }

  it('produces the canonical copy for group_offer_received', () => {
    const copy = buildNotificationCopy('group_offer_received', metadata)

    assert.equal(copy.type, 'request_received')
    assert.equal(copy.title, 'New request received')
    assert.equal(copy.body, 'You received a new group offer.')
    assert.equal(copy.targetRoute, '/offers')
    assert.equal(copy.deepLink, '/offers')
    assert.equal(copy.requestSource, 'group_offer')
    assert.deepEqual(copy.metadata, metadata)
  })

  it('produces the canonical copy for sibling_offer_closed', () => {
    const siblingMetadata = { groupOfferId: 'go-2', reason: 'another_client_accepted' }
    const copy = buildNotificationCopy('sibling_offer_closed', siblingMetadata)

    assert.equal(copy.type, 'request_closed')
    assert.equal(copy.title, 'Request closed')
    assert.equal(copy.body, 'This request is no longer available.')
    assert.equal(copy.targetRoute, '/offers')
    assert.equal(copy.deepLink, '/offers')
    assert.equal(copy.requestSource, 'group_offer')
    assert.deepEqual(copy.metadata, siblingMetadata)
  })

  it('produces the canonical copy for group_request_canceled', () => {
    const cancelMetadata = { groupRequestId: 'gr-1' }
    const copy = buildNotificationCopy('group_request_canceled', cancelMetadata)

    assert.equal(copy.type, 'request_canceled')
    assert.equal(copy.title, 'Request canceled')
    assert.equal(copy.body, 'A request was canceled.')
    assert.equal(copy.targetRoute, '/offers')
    assert.equal(copy.deepLink, '/offers')
    // group_request_canceled is emitted toward the driver about the parent
    // request, so the source is `group_request`, not `group_offer`.
    assert.equal(copy.requestSource, 'group_request')
    assert.deepEqual(copy.metadata, cancelMetadata)
  })
})

describe('buildNotificationCopy — shared invariants', () => {
  it('routes accepted requests to /journeys and other states to /offers', () => {
    const accepted = buildNotificationCopy('route_request_accepted', {})
    const received = buildNotificationCopy('route_request_received', {})
    const declined = buildNotificationCopy('route_request_declined', {})
    const canceled = buildNotificationCopy('route_request_canceled', {})

    assert.equal(accepted.targetRoute, '/journeys')
    assert.equal(accepted.deepLink, '/journeys')

    for (const copy of [received, declined, canceled]) {
      assert.equal(copy.targetRoute, '/offers')
      assert.equal(copy.deepLink, '/offers')
    }
  })

  it('keeps targetRoute and deepLink in sync for every locked event type', () => {
    const eventTypes = [
      'route_request_received',
      'route_request_accepted',
      'route_request_declined',
      'route_request_canceled',
      'group_offer_received',
      'group_offer_accepted',
      'group_offer_declined',
      'group_request_canceled',
      'sibling_offer_closed',
    ]

    for (const type of eventTypes) {
      const copy = buildNotificationCopy(type, {})
      assert.equal(
        copy.targetRoute,
        copy.deepLink,
        `targetRoute and deepLink must match for ${type}`,
      )
    }
  })

  it('preserves the supplied metadata payload verbatim', () => {
    const payload = { foo: 'bar', nested: { id: 42 } }
    const copy = buildNotificationCopy('route_request_received', payload)
    assert.deepEqual(copy.metadata, payload)
  })
})
