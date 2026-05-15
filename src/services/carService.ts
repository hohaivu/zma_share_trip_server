import { query } from '../db/connection'
import { HttpError } from '../http-error'
import * as carRepository from '../repositories/carRepository'
import { CreateCarPayload, UpdateCarPayload } from '../types/payloads'

async function assertUserRole(
  userId: string,
  role: 'driver' | 'client',
): Promise<void> {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId])
  const user = result.rows[0] as { role?: string } | undefined
  if (!user) throw new HttpError(404, 'User not found')
  if (user.role !== role) {
    throw new HttpError(403, `User must be a ${role} persona`)
  }
}

function maskPlate(full: string | undefined): string {
  if (!full || full.length < 4) return full || ''
  const prefix = full.slice(0, 4)
  const suffix = full.slice(-2)
  return `${prefix}***${suffix}`
}

export async function createCar(ownerId: string, data: CreateCarPayload) {
  await assertUserRole(ownerId, 'driver')
  return carRepository.createCar(ownerId, {
    ...data,
    plateNumberMasked: maskPlate(data.plateNumberFull),
    verificationStatus: data.verificationStatus || 'unverified',
    photos: data.photos || [],
  })
}

export async function listCarsByOwner(ownerId: string) {
  await assertUserRole(ownerId, 'driver')
  return carRepository.listCarsByOwner(ownerId)
}

export async function getCarById(id: string) {
  return carRepository.getCarById(id)
}

export async function updateCar(id: string, data: UpdateCarPayload) {
  const updatePayload = { ...data }
  if (updatePayload.plateNumberFull) {
    updatePayload.plateNumberMasked = maskPlate(updatePayload.plateNumberFull)
  }
  return carRepository.updateCar(id, updatePayload)
}

export async function deleteCar(id: string) {
  return carRepository.deleteCar(id)
}
