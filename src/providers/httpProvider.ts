import cors from 'cors'
import express from 'express'

import { Kernel, Provider } from '../kernel'

export const httpProvider: Provider = {
  name: 'http',
  register(kernel: Kernel) {
    kernel.app.use(express.json())
    kernel.app.use(
      cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
      }),
    )
  },
}
