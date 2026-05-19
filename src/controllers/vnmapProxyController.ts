import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import { asyncHandler } from '../routes/helpers'
import * as vnmapProxyService from '../services/vnmapProxyService'

function readTrimmedQueryParam(req: Request, name: string): string | undefined {
  const value = req.query[name]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readRequiredQueryParam(req: Request, name: string): string {
  const value = readTrimmedQueryParam(req, name)
  if (!value) {
    throw new HttpError(400, `Missing required query parameter: ${name}`)
  }
  return value
}

function readOptionalQueryParams(
  req: Request,
  names: string[],
): vnmapProxyService.VnmapProxyParams {
  const params: vnmapProxyService.VnmapProxyParams = {}
  for (const name of names) {
    const value = readTrimmedQueryParam(req, name)
    if (value) params[name] = value
  }
  return params
}

async function sendProxyResponse(
  params: vnmapProxyService.VnmapProxyParams,
  res: Response,
  config: vnmapProxyService.VnmapRouteConfig,
): Promise<void> {
  const response = await vnmapProxyService.proxyRequest(params, config)
  if (response.contentType) res.setHeader('content-type', response.contentType)
  res.status(response.status).send(response.body)
}

export const proxyAutocomplete = asyncHandler(async (req: Request, res: Response) => {
  await sendProxyResponse(
    {
      input: readRequiredQueryParam(req, 'input'),
      ...readOptionalQueryParams(req, ['location']),
    },
    res,
    { upstreamPath: '/place/autocomplete' },
  )
})

export const proxyPlaceDetail = asyncHandler(async (req: Request, res: Response) => {
  await sendProxyResponse(
    { place_id: readRequiredQueryParam(req, 'place_id') },
    res,
    { upstreamPath: '/place/details' },
  )
})

export const proxyDirections = asyncHandler(async (req: Request, res: Response) => {
  const mode = readTrimmedQueryParam(req, 'mode') ?? 'car'

  await sendProxyResponse(
    {
      origin: readRequiredQueryParam(req, 'origin'),
      destination: readRequiredQueryParam(req, 'destination'),
    },
    res,
    { upstreamPath: '/directions', extraParams: { mode } },
  )
})
