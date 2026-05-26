export interface CascadeDeclineSiblingsArgs {
  routeId: string | null
  planId: string | null
  exceptGroupOfferId?: string
  exceptRouteRequestId?: string
}

export interface CascadeDeclineParentGroupRequestsArgs {
  routeId: string | null
  exceptGroupRequestId?: string
}

export type CascadeExecutor = {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

function hasNonEmptyId(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function declinePendingByScope(
  executor: CascadeExecutor,
  tableName: 'group_offers' | 'route_requests' | 'group_requests',
  scopeColumn: 'route_id' | 'plan_id',
  scopeId: string,
  exceptId?: string,
): Promise<void> {
  const params: unknown[] = [scopeId]
  const exceptClause = exceptId ? ' AND id != ?' : ''
  if (exceptId) params.push(exceptId)

  await executor.query(
    `UPDATE ${tableName} SET status='declined' WHERE status='pending' AND ${scopeColumn} = ?${exceptClause}`,
    params,
  )
}

export async function cascadeDeclineParentGroupRequestsTx(
  executor: CascadeExecutor,
  args: CascadeDeclineParentGroupRequestsArgs,
): Promise<void> {
  if (!hasNonEmptyId(args.routeId)) return

  await declinePendingByScope(executor, 'group_requests', 'route_id', args.routeId, args.exceptGroupRequestId)
}

export async function cascadeDeclineSiblingsTx(
  executor: CascadeExecutor,
  args: CascadeDeclineSiblingsArgs,
): Promise<void> {
  if (hasNonEmptyId(args.routeId)) {
    await declinePendingByScope(executor, 'group_offers', 'route_id', args.routeId, args.exceptGroupOfferId)
    await declinePendingByScope(executor, 'route_requests', 'route_id', args.routeId, args.exceptRouteRequestId)
  }

  if (hasNonEmptyId(args.planId)) {
    await declinePendingByScope(executor, 'group_offers', 'plan_id', args.planId, args.exceptGroupOfferId)
    await declinePendingByScope(executor, 'route_requests', 'plan_id', args.planId, args.exceptRouteRequestId)
  }
}
