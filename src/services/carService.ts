import * as carRepository from '../repositories/carRepository'
import { assertUserRole } from './userService'
import { CreateCarPayload, UpdateCarPayload } from '../types/payloads'

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
