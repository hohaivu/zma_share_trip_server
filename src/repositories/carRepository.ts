import { query } from '../db/connection'
import { toCamelCase } from '../db/utils'
import { Car } from '../types/entities'
import { CreateCarPayload, UpdateCarPayload } from '../types/payloads'

const CAR_COLORS: Record<string, string> = {
  'Xanh dương': '#006AF5',
  Trắng: '#FFFFFF',
  Đen: '#1A1A1A',
  Đỏ: '#CC0000',
  'Xanh lá': '#00C853',
  Cam: '#FFA000',
  Tím: '#9C27B0',
  Nâu: '#795548',
  Bạc: '#C0C0C0',
  'Xanh đậm': '#1565C0',
  Xám: '#757575',
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.random().toString().slice(2, 6)}`
}

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function mapCar(row: Record<string, unknown>): Car & { colorHex?: string } {
  const c = toCamelCase<Car & { colorHex?: string }>(row)
  if (!c) throw new Error('Cannot map null row to Car')
  if (c.color) c.colorHex = CAR_COLORS[c.color] || c.color
  return c
}

async function dynamicUpdate<T>(table: string, id: string, data: Record<string, unknown>, jsonFields: string[] = []): Promise<T | null> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (keys.length === 0) {
    const existing = await query(`SELECT * FROM ${table} WHERE id = ?`, [id])
    return toCamelCase<T>(existing.rows[0])
  }
  const setClauses = keys.map((key) => `${toSnakeCase(key)} = ?`)
  const vals = keys.map((k) => (jsonFields.includes(k) ? JSON.stringify(data[k]) : data[k]))
  await query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`, [...vals, id])
  const result = await query(`SELECT * FROM ${table} WHERE id = ?`, [id])
  return toCamelCase<T>(result.rows[0])
}

export async function createCar(ownerId: string, data: CreateCarPayload): Promise<Car & { colorHex?: string }> {
  const result = await query(
    `
    INSERT INTO cars (id, owner_id, nickname, plate_number_masked, plate_number_full, brand, model, color, seat_capacity, verification_status, photos, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    RETURNING *
  `,
    [generateId('car'), ownerId, data.nickname, data.plateNumberMasked, data.plateNumberFull, data.brand, data.model, data.color, data.seatCapacity, data.verificationStatus || 'unverified', JSON.stringify(data.photos || [])],
  )
  return mapCar(result.rows[0])
}

export async function listCarsByOwner(ownerId: string): Promise<(Car & { colorHex?: string })[]> {
  const result = await query('SELECT * FROM cars WHERE owner_id = ?', [ownerId])
  return result.rows.map(mapCar)
}

export async function getCarById(id: string): Promise<(Car & { colorHex?: string }) | null> {
  const result = await query('SELECT * FROM cars WHERE id = ?', [id])
  return result.rows[0] ? mapCar(result.rows[0]) : null
}

export async function updateCar(id: string, data: UpdateCarPayload): Promise<(Car & { colorHex?: string }) | null> {
  const updated = await dynamicUpdate<Car & { colorHex?: string }>('cars', id, data as unknown as Record<string, unknown>, ['photos'])
  return updated ? mapCar(updated as unknown as Record<string, unknown>) : null
}

export async function deleteCar(id: string): Promise<boolean> {
  const result = await query('DELETE FROM cars WHERE id = ? RETURNING id', [id])
  return result.rowCount !== null && result.rowCount > 0
}
