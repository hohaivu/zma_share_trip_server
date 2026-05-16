import { Request, Response } from 'express'

import { asyncHandler } from '../routes/helpers'
import * as vnmapProxyService from '../services/vnmapProxyService'
import { HttpError } from '../http-error'

function readRequiredQueryParam(req: Request, name: string): string {
  const value = req.query[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Missing required query parameter: ${name}`)
  }

  return value.trim()
}

function readOptionalQueryParams(req: Request, names: string[]): vnmapProxyService.VnmapProxyParams {
  const params: vnmapProxyService.VnmapProxyParams = {}
  for (const name of names) {
    const value = req.query[name]
    if (typeof value === 'string' && value.trim()) {
      params[name] = value.trim()
    }
  }
  return params
}

async function sendProxyResponse(
  params: vnmapProxyService.VnmapProxyParams,
  res: Response,
  config: vnmapProxyService.VnmapRouteConfig,
) {
  const response = await vnmapProxyService.proxyRequest(params, config)
  if (response.contentType) res.setHeader('content-type', response.contentType)
  res.status(response.status).send(response.body)
}

export const proxyAutocomplete = asyncHandler(
  async (req: Request, res: Response) => {
    await sendProxyResponse(
      {
        input: readRequiredQueryParam(req, 'input'),
        ...readOptionalQueryParams(req, ['location']),
      },
      res,
      { upstreamPath: '/place/autocomplete' },
    )
  },
)

export const proxyPlaceDetail = asyncHandler(
  async (req: Request, res: Response) => {
    await sendProxyResponse(
      { place_id: readRequiredQueryParam(req, 'place_id') },
      res,
      { upstreamPath: '/place/details' },
    )
  },
)

export const proxyDirections = asyncHandler(
  async (req: Request, res: Response) => {
    const mode =
      typeof req.query.mode === 'string' && req.query.mode.trim()
        ? req.query.mode.trim()
        : 'car'

    await sendProxyResponse(
      {
        origin: readRequiredQueryParam(req, 'origin'),
        destination: readRequiredQueryParam(req, 'destination'),
      },
      res,
      { upstreamPath: '/directions', extraParams: { mode } },
    )
  },
)
