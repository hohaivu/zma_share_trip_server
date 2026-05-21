import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { Request, Response } from 'express'

import { createClientInboxController } from '../src/controllers/clientInboxController'
import { clientInboxService } from '../src/services/clientInboxService'
import { sortClientInboxItems } from '../src/shared/clientInboxSort'
import type { ClientRequestItem } from '../src/types/payloads'

const originalListClientInbox = clientInboxService.listClientInbox

afterEach(() => {
  clientInboxService.listClientInbox = originalListClientInbox
})

function makeReq(body?: { clientId?: string }): Request {
  return { body: body ?? {} } as unknown as Request
}

function makeRes(): Response & { body?: unknown } {
  return {
    json(body: unknown) {
      this.body = body
      return this
    },
  } as Response & { body?: unknown }
}

function makeItem(id: string, createdAt: string, source: 'group_offer' | 'route_request'): ClientRequestItem {
  return {
    id,
    source,
    direction: source === 'group_offer' ? 'incoming' : 'outgoing',
    clientId: 'client-001',
    routeId: 'route-001',
    driverId: 'driver-001',
    planId: 'plan-001',
    tripPrice: 45000,
    status: 'pending',
    createdAt,
  }
}

describe('sortClientInboxItems', () => {
  it('sorts items by createdAt descending', () => {
    const items = [
      makeItem('a', '2025-01-01T08:00:00Z', 'route_request'),
      makeItem('b', '2025-01-03T08:00:00Z', 'group_offer'),
      makeItem('c', '2025-01-02T08:00:00Z', 'route_request'),
    ]
    const sorted = sortClientInboxItems(items)
    assert.deepEqual(
      sorted.map((i) => i.id),
      ['b', 'c', 'a'],
    )
  })

  it('returns empty array unchanged', () => {
    assert.deepEqual(sortClientInboxItems([]), [])
  })

  it('does not mutate the input array', () => {
    const items = [
      makeItem('x', '2025-01-01T00:00:00Z', 'group_offer'),
      makeItem('y', '2025-01-02T00:00:00Z', 'group_offer'),
    ]
    const copy = [...items]
    sortClientInboxItems(items)
    assert.deepEqual(items, copy)
  })
})

describe('ClientInboxController.listClientInbox', () => {
  it('returns merged sorted items for valid clientId', async () => {
    const items: ClientRequestItem[] = [
      makeItem('offer-1', '2025-06-01T10:00:00Z', 'group_offer'),
      makeItem('req-1', '2025-06-02T10:00:00Z', 'route_request'),
    ]
    clientInboxService.listClientInbox = async () => items

    const res = makeRes()
    await createClientInboxController().listClientInbox(makeReq({ clientId: 'client-001' }), res)

    assert.deepEqual((res.body as { data: ClientRequestItem[] }).data, items)
  })

  it('throws when clientId body field is missing', async () => {
    const res = makeRes()
    await assert.rejects(
      () => createClientInboxController().listClientInbox(makeReq(), res),
    )
  })
})
