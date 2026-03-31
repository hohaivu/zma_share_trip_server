/**
 * Shared Zalo Open API proxy handlers.
 * Eliminates duplication across authorize, userInfo, phoneNumber, and location routes.
 */

const { asyncHandler } = require('./helpers')

const proxyProfile = asyncHandler(async (req, res) => {
  const { accessToken } = req.body
  const url = `https://graph.zalo.me/v2.0/me?access_token=${encodeURIComponent(accessToken)}&fields=id,name,picture`

  const response = await fetch(url)
  const data = await response.json()

  if (data.error && data.error !== 0) {
    return res
      .status(401)
      .json({ error: -1, message: 'Invalid access token' })
  }

  res.json({ error: 0, message: 'Success', data })
})

const proxySecretExchange = asyncHandler(async (req, res) => {
  const { accessToken, code } = req.body
  const secretKey = process.env.ZALO_APP_SECRET

  const url = `https://graph.zalo.me/v2.0/me/info?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}&secret_key=${encodeURIComponent(secretKey)}`

  const response = await fetch(url)
  const data = await response.json()

  if (data.error && data.error !== 0) {
    return res.status(400).json({
      error: -1,
      message: data.message || 'Token expired or invalid',
    })
  }

  res.json({ error: 0, message: 'Success', data: data.data })
})

module.exports = { proxyProfile, proxySecretExchange }
