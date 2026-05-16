import { HttpError } from '../http-error'

const VNMAP_API_BASE_URL = 'https://api.vnmap.com.vn'

const DEFAULT_VNMAP_PARAMS = {
  components: 'country:vn',
  language: 'vi',
} as const

export type VnmapRouteConfig = {
  upstreamPath: string
  extraParams?: Record<string, string>
}

export type VnmapProxyParams = Record<string, string>

export type ProxyResponse = {
  status: number
  body: string
  contentType: string | null
}

function getApiKey(): string {
  const apiKey = process.env.VNMAP_API_KEY?.trim()
  if (!apiKey) {
    throw new HttpError(503, 'VNMap API key is not configured')
  }

  return apiKey
}

function buildProviderUrl(params: VnmapProxyParams, config: VnmapRouteConfig): string {
  const url = new URL(config.upstreamPath, VNMAP_API_BASE_URL)

  for (const [key, value] of Object.entries(DEFAULT_VNMAP_PARAMS)) {
    url.searchParams.set(key, value)
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  for (const [key, value] of Object.entries(config.extraParams ?? {})) {
    url.searchParams.set(key, value)
  }

  url.searchParams.set('key', getApiKey())
  return url.toString()
}

export async function proxyRequest(
  params: VnmapProxyParams,
  config: VnmapRouteConfig,
): Promise<ProxyResponse> {
  const providerUrl = buildProviderUrl(params, config)

  let response: globalThis.Response
  try {
    response = await fetch(providerUrl)
  } catch {
    throw new HttpError(502, 'VNMap provider request failed')
  }

  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get('content-type'),
  }
}
