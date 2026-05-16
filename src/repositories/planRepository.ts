import {
  cancelPlanByClient as cancelPlanByClientStore,
  createPlan as createPlanStore,
  getPlan as getPlanStore,
  listPlansByClient as listPlansByClientStore,
  type TripListScope,
  updatePlan as updatePlanStore,
} from '../store'
import { Plan } from '../types/entities'
import {
  CreatePlanPayload,
  UpdatePlanPayload,
  WithReviewEligibility,
} from '../types/payloads'

export async function createPlan(
  clientId: string,
  data: CreatePlanPayload,
): Promise<Plan> {
  return createPlanStore(clientId, data)
}

export async function listPlansByClient(
  clientId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Plan>>> {
  return listPlansByClientStore(clientId, scope)
}

export async function getPlan(id?: string): Promise<Plan | null> {
  return getPlanStore(id)
}

export async function updatePlan(
  id: string,
  data: UpdatePlanPayload,
): Promise<Plan | null> {
  return updatePlanStore(id, data)
}

export async function cancelPlanByClient(
  planId: string,
  clientId: string,
): Promise<Plan> {
  return cancelPlanByClientStore(planId, clientId)
}
