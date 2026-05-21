import { Router } from 'express'

import { validateSchema } from '../middleware/validate'
import { manualTopUpBodySchema } from '../schemas/driverWallet'
import {
  getDriverWallet,
  listDriverWalletTransactions,
  topUpDriverWallet,
} from '../controllers/driverWalletController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/drivers/wallet/get
router.post('/wallet/get', asyncHandler(getDriverWallet))

// POST /api/drivers/wallet/transactions/list
router.post('/wallet/transactions/list', asyncHandler(listDriverWalletTransactions))

// POST /api/drivers/wallet/topups/create
router.post(
  '/wallet/topups/create',
  validateSchema('body', manualTopUpBodySchema),
  asyncHandler(topUpDriverWallet),
)

export default router
