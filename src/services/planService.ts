import * as planRepository from '../repositories/planRepository'
import { Plan } from '../types/entities'
import {
  CreatePlanPayload,
  UpdatePlanPayload,
  WithReviewEligibility,
} from '../types/payloads'
import { TripListScope } from '../store'

export async function createPlan(
  clientId: string,
  data: CreatePlanPayload,
): Promise<Plan> {
  return planRepository.createPlan(clientId, data)
}

export async function listPlansByClient(
  clientId: string,
  scope: TripListScope = 'active',
): Promise<Array<WithReviewEligibility<Plan>>> {
  return planRepository.listPlansByClient(clientId, scope)
}

export async function getPlan(id?: string): Promise<Plan | null> {
  return planRepository.getPlan(id)
}

export async function updatePlan(
  id: string,
  data: UpdatePlanPayload,
): Promise<Plan | null> {
  return planRepository.updatePlan(id, data)
}

export async function cancelPlanByClient(
  planId: string,
  clientId: string,
): Promise<Plan> {
  return planRepository.cancelPlanByClient(planId, clientId)
}
