import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cascadeDeclineParentGroupRequestsTx, cascadeDeclineSiblingsTx } from '../src/repositories/matchCascade'

type Row = {
  id: string
  route_id: string | null
  plan_id: string | null
  status: string
}

type Call = { sql: string; params: unknown[] }

function makeExecutor(tables: { group_offers: Row[]; route_requests: Row[]; group_requests?: Row[] }) {
  const calls: Call[] = []
  return {
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params })

      const tableName = sql.includes('UPDATE group_offers')
        ? 'group_offers'
        : sql.includes('UPDATE route_requests')
          ? 'route_requests'
          : 'group_requests'
      const scopeColumn = sql.includes('route_id = ?') ? 'route_id' : 'plan_id'
      const [scopeId, exceptId] = params
      let affectedRows = 0

      for (const row of tables[tableName] ?? []) {
        if (row.status !== 'pending') continue
        if (row[scopeColumn] !== scopeId) continue
        if (exceptId && row.id === exceptId) continue
        row.status = 'declined'
        affectedRows += 1
      }

      return { rows: [], rowCount: affectedRows }
    },
  }
}

describe('cascadeDeclineSiblingsTx', () => {
  it('skips plan updates when planId is null', async () => {
    const tables = {
      group_offers: [
        { id: 'go-1', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
        { id: 'go-2', route_id: 'route-2', plan_id: 'plan-1', status: 'pending' },
      ],
      route_requests: [
        { id: 'rr-1', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
        { id: 'rr-2', route_id: 'route-2', plan_id: 'plan-1', status: 'pending' },
      ],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineSiblingsTx(executor, { routeId: 'route-1', planId: null })

    assert.equal(executor.calls.length, 2)
    assert.equal(executor.calls.some((call) => call.sql.includes('plan_id = ?')), false)
    assert.equal(tables.group_offers.find((row) => row.id === 'go-1')?.status, 'declined')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-1')?.status, 'declined')
    assert.equal(tables.group_offers.find((row) => row.id === 'go-2')?.status, 'pending')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-2')?.status, 'pending')
  })

  it('applies except ids to the respective tables', async () => {
    const tables = {
      group_offers: [
        { id: 'go-keep', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
        { id: 'go-decline', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
      ],
      route_requests: [
        { id: 'rr-keep', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
        { id: 'rr-decline', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
      ],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineSiblingsTx(executor, {
      routeId: 'route-1',
      planId: 'plan-1',
      exceptGroupOfferId: 'go-keep',
      exceptRouteRequestId: 'rr-keep',
    })

    assert.equal(executor.calls.length, 4)
    assert.deepEqual(executor.calls.map((call) => call.params), [
      ['route-1', 'go-keep'],
      ['route-1', 'rr-keep'],
      ['plan-1', 'go-keep'],
      ['plan-1', 'rr-keep'],
    ])
    assert.equal(tables.group_offers.find((row) => row.id === 'go-keep')?.status, 'pending')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-keep')?.status, 'pending')
    assert.equal(tables.group_offers.find((row) => row.id === 'go-decline')?.status, 'declined')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-decline')?.status, 'declined')
  })

  it('is idempotent on re-run and preserves terminal statuses', async () => {
    const tables = {
      group_offers: [
        { id: 'go-pending', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
        { id: 'go-accepted', route_id: 'route-1', plan_id: 'plan-1', status: 'accepted' },
        { id: 'go-canceled', route_id: 'route-1', plan_id: 'plan-1', status: 'canceled' },
        { id: 'go-closed', route_id: 'route-1', plan_id: 'plan-1', status: 'closed' },
      ],
      route_requests: [
        { id: 'rr-pending', route_id: 'route-1', plan_id: 'plan-1', status: 'pending' },
        { id: 'rr-accepted', route_id: 'route-1', plan_id: 'plan-1', status: 'accepted' },
        { id: 'rr-canceled', route_id: 'route-1', plan_id: 'plan-1', status: 'canceled' },
        { id: 'rr-closed', route_id: 'route-1', plan_id: 'plan-1', status: 'closed' },
      ],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineSiblingsTx(executor, { routeId: 'route-1', planId: 'plan-1' })
    await cascadeDeclineSiblingsTx(executor, { routeId: 'route-1', planId: 'plan-1' })

    assert.equal(tables.group_offers.find((row) => row.id === 'go-pending')?.status, 'declined')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-pending')?.status, 'declined')
    assert.equal(tables.group_offers.find((row) => row.id === 'go-accepted')?.status, 'accepted')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-accepted')?.status, 'accepted')
    assert.equal(tables.group_offers.find((row) => row.id === 'go-canceled')?.status, 'canceled')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-canceled')?.status, 'canceled')
    assert.equal(tables.group_offers.find((row) => row.id === 'go-closed')?.status, 'closed')
    assert.equal(tables.route_requests.find((row) => row.id === 'rr-closed')?.status, 'closed')
  })

  it('is a no-op when no pending rows match', async () => {
    const tables = {
      group_offers: [{ id: 'go-1', route_id: 'route-2', plan_id: 'plan-2', status: 'pending' }],
      route_requests: [{ id: 'rr-1', route_id: 'route-2', plan_id: 'plan-2', status: 'pending' }],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineSiblingsTx(executor, { routeId: 'route-1', planId: 'plan-1' })

    assert.equal(tables.group_offers[0].status, 'pending')
    assert.equal(tables.route_requests[0].status, 'pending')
  })
})

describe('cascadeDeclineParentGroupRequestsTx', () => {
  it('declines only pending parent requests scoped to the route', async () => {
    const tables = {
      group_offers: [],
      route_requests: [],
      group_requests: [
        { id: 'gr-route-pending', route_id: 'route-1', plan_id: null, status: 'pending' },
        { id: 'gr-other-route', route_id: 'route-2', plan_id: null, status: 'pending' },
        { id: 'gr-no-route', route_id: null, plan_id: null, status: 'pending' },
      ],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineParentGroupRequestsTx(executor, { routeId: 'route-1' })

    assert.equal(executor.calls.length, 1)
    assert.equal(executor.calls[0].sql.includes('UPDATE group_requests'), true)
    assert.deepEqual(executor.calls[0].params, ['route-1'])
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-route-pending')?.status, 'declined')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-other-route')?.status, 'pending')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-no-route')?.status, 'pending')
  })

  it('preserves the excluded parent request', async () => {
    const tables = {
      group_offers: [],
      route_requests: [],
      group_requests: [
        { id: 'gr-keep', route_id: 'route-1', plan_id: null, status: 'pending' },
        { id: 'gr-decline', route_id: 'route-1', plan_id: null, status: 'pending' },
      ],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineParentGroupRequestsTx(executor, {
      routeId: 'route-1',
      exceptGroupRequestId: 'gr-keep',
    })

    assert.deepEqual(executor.calls.map((call) => call.params), [['route-1', 'gr-keep']])
    assert.equal(executor.calls[0].sql.includes('AND id != ?'), true)
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-keep')?.status, 'pending')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-decline')?.status, 'declined')
  })

  it('is idempotent on retry and preserves accepted, declined, canceled, and terminal rows', async () => {
    const tables = {
      group_offers: [],
      route_requests: [],
      group_requests: [
        { id: 'gr-pending', route_id: 'route-1', plan_id: null, status: 'pending' },
        { id: 'gr-accepted', route_id: 'route-1', plan_id: null, status: 'accepted' },
        { id: 'gr-declined', route_id: 'route-1', plan_id: null, status: 'declined' },
        { id: 'gr-canceled', route_id: 'route-1', plan_id: null, status: 'canceled' },
        { id: 'gr-closed', route_id: 'route-1', plan_id: null, status: 'closed' },
      ],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineParentGroupRequestsTx(executor, { routeId: 'route-1' })
    await cascadeDeclineParentGroupRequestsTx(executor, { routeId: 'route-1' })

    assert.equal(tables.group_requests.find((row) => row.id === 'gr-pending')?.status, 'declined')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-accepted')?.status, 'accepted')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-declined')?.status, 'declined')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-canceled')?.status, 'canceled')
    assert.equal(tables.group_requests.find((row) => row.id === 'gr-closed')?.status, 'closed')
  })

  it('is a no-op for null or empty route ids', async () => {
    const tables = {
      group_offers: [],
      route_requests: [],
      group_requests: [{ id: 'gr-1', route_id: 'route-1', plan_id: null, status: 'pending' }],
    }
    const executor = makeExecutor(tables)

    await cascadeDeclineParentGroupRequestsTx(executor, { routeId: null })
    await cascadeDeclineParentGroupRequestsTx(executor, { routeId: '' })
    await cascadeDeclineParentGroupRequestsTx(executor, { routeId: '   ' })

    assert.equal(executor.calls.length, 0)
    assert.equal(tables.group_requests[0].status, 'pending')
  })
})
