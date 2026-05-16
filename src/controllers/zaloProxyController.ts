import { Request, Response } from 'express'

import { asyncHandler } from '../routes/helpers'
import * as zaloProxyService from '../services/zaloProxyService'

export const proxyProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const { accessToken } = req.body
    const result = await zaloProxyService.proxyProfile(accessToken)

    if (!result.ok) {
      return res.status(result.status).json(result.body)
    }

    res.json({ error: 0, message: 'Success', data: result.data })
  },
)

export const proxySecretExchange = asyncHandler(
  async (req: Request, res: Response) => {
    const { accessToken, code } = req.body
    const result = await zaloProxyService.proxySecretExchange(accessToken, code)

    if (!result.ok) {
      return res.status(result.status).json(result.body)
    }

    res.json({ error: 0, message: 'Success', data: result.data })
  },
)
