import { NextFunction, Request, Response } from 'express'

import { Kernel, Provider } from '../kernel'
import { buildErrorResponse } from '../shared/responseEnvelope'

export const errorProvider: Provider = {
  name: 'error',
  register(kernel: Kernel) {
    kernel.app.use(
      (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        const { status, body } = buildErrorResponse(err)
        if (status === 500) console.error('[server error]', err)
        res.status(status).json(body)
      },
    )
  },
}
