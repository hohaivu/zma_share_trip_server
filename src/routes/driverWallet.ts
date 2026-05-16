import { Router } from 'express'

import {
  getDriverWallet,
  listDriverWalletTransactions,
  topUpDriverWallet,
} from '../controllers/driverWalletController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/driver/wallet?driverId=
router.get('/wallet', asyncHandler(getDriverWallet))

// GET /api/driver/wallet/transactions?driverId=&limit=
router.get('/wallet/transactions', asyncHandler(listDriverWalletTransactions))

// POST /api/driver/wallet/topups
router.post('/wallet/topups', asyncHandler(topUpDriverWallet))

export default router
