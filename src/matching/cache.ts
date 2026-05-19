import * as userService from '../services/userService'
import { User } from '../types/entities'
import { FilterContext } from './ports'

export async function getCachedBlockedUsers(
  ctx: FilterContext,
  userId: string,
): Promise<string[]> {
  const cached = ctx.blockedUserCache.get(userId)
  if (cached) return cached
  const ids = await userService.getBlockedUsers(userId)
  ctx.blockedUserCache.set(userId, ids)
  return ids
}

export async function getCachedUser(
  ctx: FilterContext,
  userId: string,
): Promise<User | null> {
  if (ctx.userCache.has(userId)) return ctx.userCache.get(userId)!
  const user = await userService.getUser(userId)
  ctx.userCache.set(userId, user)
  return user
}
