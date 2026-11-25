import { Request, Response } from 'express'

import * as authService from '../services/authService'

export function issueToken(req: Request, res: Response): void {
  const { api_key, api_secret } = req.body
  const { token } = authService.issueToken(api_key, api_secret)
  // Raw JSON (no envelope) to match the ALI reference authApi.
  res.json({
    base_url: process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`,
    token,
  })
}
