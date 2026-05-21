import { z } from 'zod'

/**
 * Body schema for `POST /api/drivers/wallet/topups/create`.
 *
 * Validation rules mirror the previous inline checks in
 * `src/routes/driverWallet.ts`:
 * - `driverId` is a required non-empty string.
 * - `amountVnd` is a positive integer (VND has no fractional unit).
 * - `description` is optional and, when present, must be a string.
 */
export const manualTopUpBodySchema = z.object({
  driverId: z.string().trim().min(1, 'driverId is required'),
  amountVnd: z
    .number({ message: 'amountVnd must be a positive integer' })
    .int('amountVnd must be a positive integer')
    .positive('amountVnd must be a positive integer'),
  description: z.string().optional(),
})

export type ManualTopUpBody = z.infer<typeof manualTopUpBodySchema>
