import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createDemandGroupService } from '../src/services/demandGroupService'
import type { Plan } from '../src/types/entities'
import type { DemandGroupSummary } from '../src/types/payloads'

function makeSummary(): DemandGroupSummary {
  return {
    id: 'dg-2026-06-01|ow_op|dw_dp|2026-06-01T08:00:00.000Z',
    departureDate: '2026-06-01',
    originWardId: 'ow',
    destinationWardId: 'dw',
    originProvinceId: 'op',
    destinationProvinceId: 'dp',
    windowStart: '2026-06-01T08:00:00.000Z',
    windowEnd: '2026-06-01T09:00:00.000Z',
    memberCount: 2,
    totalPassengerCount: 3,
    origin: { lat: 10, lng: 106 },
    destination: { lat: 11, lng: 107 },
    memberPlanIds: ['plan-001', 'plan-002'],
    clientIds: ['client-001', 'client-002'],
  }
}

describe('DemandGroupService.getDemandGroupDetail', () => {
  it('returns members when requested for repository-derived summaries without visibilityMode', async () => {
    const summary = makeSummary()
    const members = [{ id: 'plan-001' }, { id: 'plan-002' }] as Plan[]
    let requestedMembersFor: string | undefined
    const service = createDemandGroupService({
      async getDemandGroup(groupId) {
        assert.equal(groupId, summary.id)
        return summary
      },
      async getDemandGroupMembers(groupId) {
        requestedMembersFor = groupId
        return members
      },
    })

    const detail = await service.getDemandGroupDetail(summary.id, {
      includeMembers: true,
    })

    assert.equal(requestedMembersFor, summary.id)
    assert.deepEqual(detail, { summary, members })
  })

  it('returns summary only when members are not requested', async () => {
    const summary = makeSummary()
    let requestedMembers = false
    const service = createDemandGroupService({
      async getDemandGroup() {
        return summary
      },
      async getDemandGroupMembers() {
        requestedMembers = true
        return []
      },
    })

    const detail = await service.getDemandGroupDetail(summary.id, {
      includeMembers: false,
    })

    assert.equal(requestedMembers, false)
    assert.deepEqual(detail, { summary })
  })
})
