import { HttpError } from '../http-error'
import type { DbQueryExecutor } from './walletRepository'

export const REFRESH_AVAILABLE_DETAILS = { refreshHint: 'refresh_available' } as const

export async function expirePendingMatchesTx(executor: DbQueryExecutor): Promise<void> {
  await executor.query(
    `
      UPDATE route_requests rr
      SET status = 'expired'
      FROM routes r, plans p
      WHERE rr.route_id = r.id
        AND rr.plan_id = p.id
        AND rr.status = 'pending'
        AND NOW() >= LEAST(r.window_end, p.departure_block_end)
    `,
    [],
  )

  await executor.query(
    `
      UPDATE group_offers go
      SET status = 'expired'
      FROM routes r, plans p
      WHERE go.route_id = r.id
        AND go.plan_id = p.id
        AND go.status = 'pending'
        AND NOW() >= LEAST(r.window_end, p.departure_block_end)
    `,
    [],
  )
}

export async function assertRoutePlanEndsInFutureTx(
  executor: DbQueryExecutor,
  routeId: string,
  planId?: string | null,
  message = 'Route or plan is no longer available',
): Promise<void> {
  const result = await executor.query(
    `
      SELECT 1
      FROM routes r
      JOIN plans p ON p.id = $2
      WHERE r.id = $1
        AND NOW() < r.window_end
        AND NOW() < p.departure_block_end
      LIMIT 1
    `,
    [routeId, planId ?? null],
  )

  if (result.rowCount === 0) {
    throw HttpError.withSafeDetails(409, message, REFRESH_AVAILABLE_DETAILS)
  }
}

export async function closePendingMatchesForRoute(routeId: string, executor: DbQueryExecutor): Promise<void> {
  await executor.query("UPDATE route_requests SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [routeId])
  await executor.query("UPDATE group_offers SET status = 'closed' WHERE route_id = $1 AND status = 'pending'", [routeId])
  await closePendingGroupRequestsWithNoPendingOffers(executor, 'route_id', routeId)
}

export async function closePendingMatchesForPlan(planId: string, executor: DbQueryExecutor): Promise<void> {
  await executor.query("UPDATE route_requests SET status = 'closed' WHERE plan_id = $1 AND status = 'pending'", [planId])
  await executor.query("UPDATE group_offers SET status = 'closed' WHERE plan_id = $1 AND status = 'pending'", [planId])
  await closePendingGroupRequestsWithNoPendingOffers(executor, 'plan_id', planId)
}

async function closePendingGroupRequestsWithNoPendingOffers(
  executor: DbQueryExecutor,
  affectedOfferColumn: 'route_id' | 'plan_id',
  id: string,
): Promise<void> {
  await executor.query(
    `
      UPDATE group_requests gr
      SET status = 'closed'
      WHERE gr.status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM group_offers affected
          WHERE affected.group_request_id = gr.id
            AND affected.${affectedOfferColumn} = $1
        )
        AND NOT EXISTS (
          SELECT 1
          FROM group_offers remaining
          WHERE remaining.group_request_id = gr.id
            AND remaining.status = 'pending'
        )
    `,
    [id],
  )
}
