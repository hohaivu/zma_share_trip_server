import cors from 'cors'

import { Kernel, Provider } from '../kernel'

export const httpProvider: Provider = {
  name: 'http',
  register(kernel: Kernel) {
    kernel.app.use(
      cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
      }),
    )
  },
}
