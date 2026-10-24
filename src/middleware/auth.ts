import type { MiddlewareHandler } from "hono";

import { authenticate } from "@/lib/auth";
import type { AppEnv } from "@/src/types";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
	const auth = await authenticate(c.req.raw);
	c.set("auth", auth);
	await next();
};

