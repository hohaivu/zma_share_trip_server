import { Router } from 'express'

import {
  proxyAutocomplete,
  proxyDirections,
  proxyPlaceDetail,
} from './vnmapProxy'

const router = Router()

router.get('/vnmap/place/autocomplete', proxyAutocomplete)
router.get('/vnmap/place/details', proxyPlaceDetail)
router.get('/vnmap/directions', proxyDirections)

export default router
