import { z } from 'zod'

/** Body schema for `POST /api/auth`. */
export const authBodySchema = z.object({
  api_key: z.string().min(1, 'api_key is required'),
  api_secret: z.string().min(1, 'api_secret is required'),
})
