import { Hono } from "hono";

import { ok } from "@/lib/http";
import type { AppEnv } from "@/src/types";

export const healthRouter = new Hono<AppEnv>();

healthRouter.get("/", () => {
	return ok({ status: "healthy" });
});

