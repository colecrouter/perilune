export function mailConfig(env: NodeJS.ProcessEnv = process.env) {
	const host = env.PERILUNE_SMTP_HOST?.trim();
	if (!host) return null;
	const port = Number(env.PERILUNE_SMTP_PORT || 465),
		from = env.PERILUNE_SMTP_FROM?.trim();
	if (!Number.isInteger(port) || port < 1 || port > 65535 || !from || /[\r\n]/.test(from))
		throw Error('Configure a valid SMTP port and sender.');
	if (!!env.PERILUNE_SMTP_USER !== !!env.PERILUNE_SMTP_PASSWORD)
		throw Error('Configure both SMTP username and password.');
	return {
		host,
		port,
		from,
		secure: port === 465,
		requireTLS: port !== 465 && env.PERILUNE_SMTP_ALLOW_INSECURE !== 'true',
		auth: env.PERILUNE_SMTP_USER
			? { user: env.PERILUNE_SMTP_USER, pass: env.PERILUNE_SMTP_PASSWORD! }
			: undefined,
		connectionTimeout: 5000,
		greetingTimeout: 5000,
		socketTimeout: 10000,
		disableFileAccess: true,
		disableUrlAccess: true
	};
}
