import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { Request, Response } from 'express'

import { createDemandGroupsController } from '../src/controllers/demandGroupsController'
import { demandGroupService } from '../src/services/demandGroupService'
import type { DemandGroupDetail } from '../src/services/demandGroupService'

const originalGetDemandGroupDetail = demandGroupService.getDemandGroupDetail

afterEach(() => {
  demandGroupService.getDemandGroupDetail = originalGetDemandGroupDetail
})

function makeSummary(visibilityMode: string) {
  return {
    id: 'dg-001',
    originWardId: 'ow',
    destinationWardId: 'dw',
    originProvinceId: 'op',
    destinationProvinceId: 'dp',
    departureWindowStartDate: '2026-06-01T08:00:00.000Z',
    departureWindowEndDate: '2026-06-01T09:00:00.000Z',
    memberCount: 2,
    totalPassengerCount: 3,
    origin: { lat: 10, lng: 106 },
    destination: { lat: 11, lng: 107 },
    memberPlanIds: ['plan-001', 'plan-002'],
    clientIds: ['client-001', 'client-002'],
    visibilityMode,
  }
}

function makeReq(include?: string): Request {
  return {
    params: { id: 'dg-001' },
    query: include ? { include } : {},
  } as unknown as Request
}

function makeRes(): Response & { body?: unknown; statusCodeValue?: number } {
  return {
    json(body: unknown) {
      this.body = body
      return this
    },
    status(code: number) {
      this.statusCodeValue = code
      return this
    },
  } as Response & { body?: unknown; statusCodeValue?: number }
}

describe('DemandGroupsController.getDemandGroup', () => {
  it('returns summary only without include query param', async () => {
    const summary = makeSummary('group_with_client_list')
    let includeMembers: boolean | undefined
    demandGroupService.getDemandGroupDetail = async (_groupId, options) => {
      includeMembers = options.includeMembers
      return { summary } as DemandGroupDetail
    }

    const res = makeRes()
    await createDemandGroupsController().getDemandGroup(makeReq(), res)

    assert.equal(includeMembers, false)
    assert.deepEqual(res.body, { summary })
  })

  it('returns summary and members when include=members and visibility permits', async () => {
    const summary = makeSummary('group_with_client_list')
    const members = [{ id: 'plan-001' }, { id: 'plan-002' }]
    demandGroupService.getDemandGroupDetail = async (_groupId, options) => {
      assert.equal(options.includeMembers, true)
      return { summary, members } as unknown as DemandGroupDetail
    }

    const res = makeRes()
    await createDemandGroupsController().getDemandGroup(makeReq('members'), res)

    assert.deepEqual(res.body, { summary, members })
  })

  it('omits members when include=members but visibility forbids', async () => {
    const summary = makeSummary('group_summary_only')
    demandGroupService.getDemandGroupDetail = async (_groupId, options) => {
      assert.equal(options.includeMembers, true)
      return { summary } as DemandGroupDetail
    }

    const res = makeRes()
    await createDemandGroupsController().getDemandGroup(makeReq('members'), res)

    assert.deepEqual(res.body, { summary })
  })
})
