import assert from 'node:assert/strict'
import { after, before, describe } from 'node:test'

import { query } from '../src/db/connection'
import * as demandGroupRepository from '../src/repositories/demandGroupRepository'
import * as groupRequestService from '../src/services/groupRequestService'
import {
  createDbTest,
  setupTestDb,
  teardownTestDb,
} from '../src/test-db'

const it = createDbTest('MariaDB unavailable for DB-backed group request tests')
const DRIVER_001_ID = 'a1b2c3d4-0001-4000-8000-000000000001'

before(async () => {
  await setupTestDb()
})

after(async () => {
  await teardownTestDb()
})

describe('group request memberPlanIds validation', () => {
  it('fans out offers only to the submitted valid memberPlanIds snapshot', async () => {
    const groups = await demandGroupRepository.deriveDemandGroups()
    const group = groups.find((candidate) => candidate.memberCount > 1)
    if (!group) throw new Error('Expected a multi-member demand group')

    const selectedMemberPlanIds = [group.memberPlanIds[0]]
    const result = await groupRequestService.createGroupRequest(
      DRIVER_001_ID,
      'route-001',
      group.id,
      selectedMemberPlanIds,
    )

    assert.equal(result.offers.length, 1)
    assert.equal(result.offers[0].planId, selectedMemberPlanIds[0])
  })

  it('rejects stale memberPlanIds with 409 and does not create requests or offers', async () => {
    await setupTestDb()
    const groups = await demandGroupRepository.deriveDemandGroups()
    const group = groups.find((candidate) => candidate.memberCount > 1)
    if (!group) throw new Error('Expected a multi-member demand group')
    const stalePlanId = group.memberPlanIds[0]

    await query(
      "INSERT INTO group_offers (id, group_request_id, route_id, driver_id, client_id, plan_id, trip_price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', NOW())",
      [
        'goffer-stale-test',
        null,
        'route-002',
        DRIVER_001_ID,
        'a1b2c3d4-0003-4000-8000-000000000003',
        stalePlanId,
        100000,
      ],
    )

    await assert.rejects(
      async () =>
        await groupRequestService.createGroupRequest(
          DRIVER_001_ID,
          'route-001',
          group.id,
          group.memberPlanIds,
        ),
      (err: unknown) => {
        const conflict = err as {
          statusCode?: number
          payload?: { staleMemberPlanIds?: string[] }
        }
        assert.equal(conflict.statusCode, 409)
        assert.deepEqual(conflict.payload?.staleMemberPlanIds, [stalePlanId])
        return true
      },
    )

    const requests = await query('SELECT * FROM group_requests')
    const offers = await query("SELECT * FROM group_offers WHERE id <> 'goffer-stale-test'")
    assert.equal(requests.rows.length, 0)
    assert.equal(offers.rows.length, 0)
  })
})
