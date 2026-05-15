import { HttpError } from '../http-error'
import * as userRepository from '../repositories/userRepository'
import { BootstrapSession, User } from '../types/entities'
import { UpdateUserPayload } from '../types/payloads'

const EDITABLE_USER_FIELDS = new Set<keyof UpdateUserPayload>([
  'displayName',
  'avatarUrl',
  'phone',
  'preferredMode',
])

function assertEditableUserUpdate(data: UpdateUserPayload): void {
  for (const key of Object.keys(data)) {
    if (!EDITABLE_USER_FIELDS.has(key as keyof UpdateUserPayload)) {
      throw new HttpError(400, `Field is not editable: ${key}`)
    }
  }
}

function assertValidMode(mode: string): void {
  if (mode !== 'driver' && mode !== 'client') {
    throw new HttpError(400, 'preferredMode must be driver or client')
  }
}

export async function getUser(userId: string): Promise<User | null> {
  return userRepository.findUserById(userId)
}

export async function updateUser(
  userId: string,
  data: UpdateUserPayload,
): Promise<User | null> {
  assertEditableUserUpdate(data)
  const user = await userRepository.findUserById(userId)
  if (!user?.identityId) return null
  const identity = await userRepository.updateUserIdentity(user.identityId, data)
  if (!identity) return null
  return userRepository.findUserById(userId)
}

export async function setUserMode(
  identityId: string,
  mode: string,
): Promise<BootstrapSession | null> {
  assertValidMode(mode)
  const identity = await userRepository.updateIdentityMode(identityId, mode)
  if (!identity) return null
  return userRepository.buildSession(
    identity,
    await userRepository.listPersonasByIdentity(identityId),
    false,
  )
}

export async function getUserMode(
  identityId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  return userRepository.findIdentityMode(identityId)
}

export async function setModeForUser(
  userId: string,
  mode: string,
): Promise<BootstrapSession | null> {
  const user = await userRepository.findUserById(userId)
  return user?.identityId ? setUserMode(user.identityId, mode) : null
}

export async function getModeForUser(
  userId: string,
): Promise<{ preferredMode: string; modeSelectedAt: string } | null> {
  const user = await userRepository.findUserById(userId)
  return user?.identityId ? getUserMode(user.identityId) : null
}
