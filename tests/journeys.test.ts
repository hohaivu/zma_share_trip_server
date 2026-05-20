import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildJourneySummary } from '../src/services/journeyService'
import { Plan, Route, User } from '../src/types/entities'
import { JourneyAcceptedState, ReviewEligibility } from '../src/types/payloads'

const BASE_USER: User = {
  id: 'user-001',
  mauid: 'zalo-user-001',
  displayName: 'User 001',
  avatarUrl: 'https://example.com/avatar.png',
}

const BASE_ROUTE: Route = {
  id: 'route-001',
  driverId: 'driver-001',
  carId: 'car-001',
  origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
  destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
  originWardId: 'ward-q1',
  originProvinceId: '79',
  destinationWardId: 'ward-td',
  destinationProvinceId: '79',
  departureWindowStartDate: '2030-04-01T06:45:00.000Z',
  departureWindowEndDate: '2030-04-01T07:15:00.000Z',
  tripPrice: 150000,
  status: 'published',
}

const BASE_PLAN: Plan = {
  id: 'plan-001',
  clientId: 'client-001',
  origin: { lat: 10.7769, lng: 106.7009, label: 'Quận 1' },
  destination: { lat: 10.8544, lng: 106.7539, label: 'Thủ Đức' },
  originWardId: 'ward-q1',
  originProvinceId: '79',
  destinationWardId: 'ward-td',
  destinationProvinceId: '79',
  departureWindowStartDate: '2030-04-01T07:00:00.000Z',
  departureWindowEndDate: '2030-04-01T07:30:00.000Z',
  passengerCount: 1,

  status: 'published',
}

describe('buildJourneySummary', () => {
  it('preserves a route payload and adds accepted search-request state', () => {
    const accepted: JourneyAcceptedState = {
      type: 'route_request',
      requestId: 'sreq-001',
      tripPrice: 150000,
      status: 'accepted',
      matchedUser: BASE_USER,
      plan: BASE_PLAN,
    }

    const summary = buildJourneySummary(BASE_ROUTE, accepted)

    assert.equal(summary.id, BASE_ROUTE.id)
    assert.equal(summary.departureWindowStartDate, BASE_ROUTE.departureWindowStartDate)
    assert.equal(summary.accepted?.type, 'route_request')
    assert.equal(summary.accepted?.requestId, 'sreq-001')
    assert.equal(summary.accepted?.plan?.id, BASE_PLAN.id)
  })

  it('preserves a plan payload and allows a null accepted state', () => {
    const summary = buildJourneySummary(BASE_PLAN, null)

    assert.equal(summary.id, BASE_PLAN.id)
    assert.equal(summary.departureWindowStartDate, BASE_PLAN.departureWindowStartDate)
    assert.equal(summary.origin.label, BASE_PLAN.origin.label)
    assert.equal(summary.accepted, null)
  })

  it('includes viewer-scoped review eligibility when supplied', () => {
    const reviewEligibility: ReviewEligibility = {
      canSubmit: true,
      hasSubmitted: false,
      reason: 'eligible',
      windowClosesAt: '2030-04-02T07:00:00.000Z',
      revieweeId: 'client-001',
    }

    const summary = buildJourneySummary(BASE_ROUTE, null, reviewEligibility)

    assert.deepEqual(summary.reviewEligibility, reviewEligibility)
  })
})
