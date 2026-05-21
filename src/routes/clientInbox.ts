import { Router } from 'express'

import { clientInboxController } from '../controllers/clientInboxController'
import { asyncHandler } from './helpers'

const router = Router()

// POST /api/clients/inbox/list
router.post('/inbox/list', asyncHandler(clientInboxController.listClientInbox))

export default router
