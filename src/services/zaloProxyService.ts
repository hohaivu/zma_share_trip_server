export type ZaloProfileResult =
  | { ok: true; data: any }
  | { ok: false; status: 401; body: { error: -1; message: string } }

export type ZaloSecretExchangeResult =
  | { ok: true; data: any }
  | { ok: false; status: 400; body: { error: -1; message: string } }

export async function proxyProfile(
  accessToken: string,
): Promise<ZaloProfileResult> {
  const url = `https://graph.zalo.me/v2.0/me?access_token=${encodeURIComponent(
    accessToken,
  )}&fields=id,name,picture`

  const response = await fetch(url)
  const data = await response.json()

  if (data.error && data.error !== 0) {
    return {
      ok: false,
      status: 401,
      body: { error: -1, message: 'Invalid access token' },
    }
  }

  return { ok: true, data }
}

export async function proxySecretExchange(
  accessToken: string,
  code: string,
): Promise<ZaloSecretExchangeResult> {
  const secretKey = process.env.ZALO_APP_SECRET || ''

  const url = `https://graph.zalo.me/v2.0/me/info?access_token=${encodeURIComponent(
    accessToken,
  )}&code=${encodeURIComponent(code)}&secret_key=${encodeURIComponent(
    secretKey,
  )}`

  const response = await fetch(url)
  const data = await response.json()

  if (data.error && data.error !== 0) {
    return {
      ok: false,
      status: 400,
      body: {
        error: -1,
        message: data.message || 'Token expired or invalid',
      },
    }
  }

  return { ok: true, data: data.data }
}
