import { Request, Response } from 'express'

import * as demandGroupService from '../services/demandGroupService'
import { notFound, requireParam } from './helpers'

interface DemandGroupIdPayload {
  demandGroupId?: string
  id?: string
}

function demandGroupIdFromBody(body: DemandGroupIdPayload | undefined): string {
  const demandGroupId = body?.demandGroupId ?? body?.id
  requireParam(demandGroupId, 'demandGroupId is required')
  return demandGroupId
}

export async function getDemandGroup(
  req: Request<Record<string, never>, unknown, DemandGroupIdPayload>,
  res: Response,
): Promise<void | Response> {
  const demandGroupId = demandGroupIdFromBody(req.body)
  const group = await demandGroupService.getDemandGroup(demandGroupId)
  if (!group) return notFound(res, 'Demand group not found')

  res.json(group)
}

export async function listDemandGroupMembers(
  req: Request<Record<string, never>, unknown, DemandGroupIdPayload>,
  res: Response,
): Promise<void | Response> {
  const demandGroupId = demandGroupIdFromBody(req.body)
  const members = await demandGroupService.listDemandGroupMembers(demandGroupId)
  if (!members) return notFound(res, 'Demand group not found')

  res.json(members)
}
