function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err) => {
      const status = err.statusCode || 500
      res.status(status).json({ message: err.message })
    })
}

function requireParam(value, message) {
  if (!value) {
    const err = new Error(message)
    err.statusCode = 400
    throw err
  }
}

module.exports = { asyncHandler, requireParam }
