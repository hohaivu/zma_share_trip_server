import { Request, Response } from 'express'

import { Kernel, Provider } from '../kernel'

export const healthProvider: Provider = {
  name: 'health',
  register(kernel: Kernel) {
    kernel.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })
  },
}
