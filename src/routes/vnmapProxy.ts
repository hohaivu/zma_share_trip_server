import { Request, Response } from 'express'

import { HttpError } from '../http-error'
import { asyncHandler } from './helpers'

const VNMAP_API_BASE_URL = 'https://api.vnmap.com.vn'

const DEFAULT_VNMAP_PARAMS = {
  components: 'country:vn',
  language: 'vi',
} as const

type RouteConfig = {
  upstreamPath: string
  requiredParams: string[]
  optionalParams?: string[]
  extraParams?: Record<string, string>
}

function getApiKey(): string {
  const apiKey = process.env.VNMAP_API_KEY?.trim()
  if (!apiKey) {
    throw new HttpError(503, 'VNMap API key is not configured')
  }

  return apiKey
}

function readRequiredQueryParam(req: Request, name: string): string {
  const value = req.query[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Missing required query parameter: ${name}`)
  }

  return value.trim()
}

function buildProviderUrl(req: Request, config: RouteConfig): string {
  const url = new URL(config.upstreamPath, VNMAP_API_BASE_URL)

  for (const [key, value] of Object.entries(DEFAULT_VNMAP_PARAMS)) {
    url.searchParams.set(key, value)
  }

  for (const param of config.requiredParams) {
    url.searchParams.set(param, readRequiredQueryParam(req, param))
  }

  for (const param of config.optionalParams ?? []) {
    const value = req.query[param]
    if (typeof value === 'string' && value.trim()) {
      url.searchParams.set(param, value.trim())
    }
  }

  for (const [key, value] of Object.entries(config.extraParams ?? {})) {
    url.searchParams.set(key, value)
  }

  url.searchParams.set('key', getApiKey())
  return url.toString()
}

async function proxyRequest(req: Request, res: Response, config: RouteConfig) {
  const providerUrl = buildProviderUrl(req, config)

  let response: globalThis.Response
  try {
    response = await fetch(providerUrl)
  } catch {
    throw new HttpError(502, 'VNMap provider request failed')
  }

  const rawBody = await response.text()
  const contentType = response.headers.get('content-type')
  if (contentType) res.setHeader('content-type', contentType)

  res.status(response.status).send(rawBody)
}

export const proxyAutocomplete = asyncHandler(
  async (req: Request, res: Response) => {
    await proxyRequest(req, res, {
      upstreamPath: '/place/autocomplete',
      requiredParams: ['input'],
      optionalParams: ['location'],
    })
  },
)

export const proxyPlaceDetail = asyncHandler(
  async (req: Request, res: Response) => {
    await proxyRequest(req, res, {
      upstreamPath: '/place/details',
      requiredParams: ['place_id'],
    })
  },
)

export const proxyDirections = asyncHandler(
  async (req: Request, res: Response) => {
    const mode =
      typeof req.query.mode === 'string' && req.query.mode.trim()
        ? req.query.mode.trim()
        : 'car'

    await proxyRequest(req, res, {
      upstreamPath: '/directions',
      requiredParams: ['origin', 'destination'],
      extraParams: { mode },
    })
  },
)
