import { NextFunction, Request, Response } from 'express'

import { HttpError } from '../http-error'
import { Kernel, Provider } from '../kernel'
import { errorBody, httpErrorCode } from '../shared/responseEnvelope'

export const errorProvider: Provider = {
  name: 'error',
  register(kernel: Kernel) {
    kernel.app.use(
      (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        const status = err instanceof HttpError ? err.statusCode : 500
        const message = status === 500 ? 'Internal server error' : err.message
        if (status === 500) console.error('[server error]', err)
        const details =
          err instanceof HttpError && err.exposeDetails && status !== 500
            ? err.payload
            : undefined
        res
          .status(status)
          .json(errorBody(httpErrorCode(status), message, { details }))
      },
    )
  },
}
