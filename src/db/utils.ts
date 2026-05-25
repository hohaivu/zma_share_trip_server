// Helper functions to safely convert DB results to TS domains.

import type { Location } from '../types/entities'

export function parseLocationJson(value: unknown): Location | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Location
    } catch {
      return null
    }
  }
  return value as Location
}

export function mapCounterpartyRow(
  r: Record<string, unknown>,
  prefix = 'cp',
): import('../types/payloads').Counterparty | null {
  const id = r[`${prefix}Id`] as string | null
  if (!id) return null
  return {
    id,
    displayName: r[`${prefix}DisplayName`] as string,
    avatarUrl: r[`${prefix}AvatarUrl`] as string,
    ratingAvg: r[`${prefix}RatingAvg`] != null ? Number(r[`${prefix}RatingAvg`]) : undefined,
    tripCount: r[`${prefix}TripCount`] != null ? Number(r[`${prefix}TripCount`]) : undefined,
    verificationStatus: r[`${prefix}VerificationStatus`] as string | undefined,
  }
}

export function normalizeUtc(
  val: string | Date | null | undefined,
): string | undefined {
  if (!val) return undefined
  return new Date(val).toISOString()
}

export function parseJsonb<T>(val: unknown): T | null {
  if (!val) return null
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T
    } catch {
      return null
    }
  }
  return val as T
}

export function parseNumeric(val: unknown): number {
  if (!val) return 0
  if (typeof val === 'number') return val
  const parsed = parseFloat(String(val))
  return isNaN(parsed) ? 0 : parsed
}

export function toCamelCaseRecord(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const res: Record<string, unknown> = {}
  for (const key in row) {
    let val = row[key]
    if (val instanceof Date) {
      val = val.toISOString()
    } else if (
      typeof val === 'string' &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(val)
    ) {
      // MariaDB DATETIME(3) with dateStrings:true — treat as UTC
      val = new Date(val.replace(' ', 'T') + 'Z').toISOString()
    }
    const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
    res[camelKey] = val
  }
  return res
}

// Convert column mappings recursively if necessary, but returning generic Record
export function toCamelCase<T>(
  row: Record<string, unknown> | null | undefined,
): T | null {
  if (!row) return null
  return toCamelCaseRecord(row) as unknown as T
}

/**
 * Map an array of rows through toCamelCase, filtering out nulls.
 * Replaces the repeated `.map(row => toCamelCase<T>(row)).filter(Boolean) as T[]` pattern.
 */
export function mapRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => toCamelCase<T>(row)).filter(Boolean) as T[]
}
