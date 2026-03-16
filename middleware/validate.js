/**
 * Factory that returns middleware requiring specific body fields.
 * Usage: validate('accessToken', 'code')
 */
function validate(...requiredFields) {
	return (req, res, next) => {
		for (const field of requiredFields) {
			if (!req.body[field]) {
				return res
					.status(400)
					.json({ error: -1, message: `Missing required field: ${field}` });
			}
		}
		next();
	};
}

module.exports = validate;
