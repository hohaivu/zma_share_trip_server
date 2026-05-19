import { Router } from 'express'

import { clientInboxController } from '../controllers/clientInboxController'
import { asyncHandler } from './helpers'

const router = Router()

// GET /api/client/inbox?clientId=
router.get('/inbox', asyncHandler(clientInboxController.listClientInbox))

export default router
