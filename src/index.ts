import 'dotenv/config'

import { checkConnection } from './db/connection'
import { createKernel } from './kernel'
import { errorProvider } from './providers/errorProvider'
import { healthProvider } from './providers/healthProvider'
import { httpProvider } from './providers/httpProvider'
import { routeProvider } from './providers/routeProvider'

const PORT = process.env.PORT || 3010

const kernel = createKernel()
  .register(httpProvider)
  .register(routeProvider)
  .register(healthProvider)
  .register(errorProvider) // MUST be last (error middleware)

async function start() {
  try {
    console.log('Connecting to Postgres...')
    await checkConnection()
    console.log('✓ Postgres connected')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('⨯ Failed to connect to Postgres:', message)
    process.exit(1)
  }

  await kernel.boot()

  kernel.app.listen(PORT, () => {
    if (!process.env.ZALO_APP_ID) console.warn('⚠ ZALO_APP_ID is not set')
    if (!process.env.ZALO_APP_SECRET)
      console.warn('⚠ ZALO_APP_SECRET is not set')
    if (!process.env.VNMAP_API_KEY) console.warn('⚠ VNMAP_API_KEY is not set')
    console.log(`✓ cung-tuyen-api listening on :${PORT}`)
  })
}

if (require.main === module) {
  start()
}

export { kernel }
export default kernel.app
