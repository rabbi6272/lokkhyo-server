import type { MiddlewareHandler } from "hono";

export const loggingMiddleware: MiddlewareHandler = async (c, next) => {
	if (process.env.LOG_REQUESTS === "0") {
		await next();
		return;
	}

	const start = Date.now();
	await next();
	const ms = Date.now() - start;
	const status = c.res.status;
	const uid = (c.get("auth" as any) as any)?.uid
		? ` uid=${(c.get("auth" as any) as any).uid}`
		: "";
	const line = `${c.req.method} ${c.req.path} ${status} ${ms}ms${uid}`;

	if (status >= 400) {
		console.warn(line);
	} else {
		console.log(line);
	}
};

