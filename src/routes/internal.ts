import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";

import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/lib/http";
import { runDispatch } from "@/services/dispatch";
import type { AppEnv } from "@/src/types";

export const internalRouter = new Hono<AppEnv>();

async function handleDispatch(c: any): Promise<Response> {
	const secret = process.env.CRON_SECRET;
	if (!secret) {
		console.error("[dispatch] CRON_SECRET is not set; refusing to run");
		throw new AppError(ErrorCode.INTERNAL_ERROR, "Dispatch is not configured");
	}

	const header = c.req.header("authorization") ?? "";
	const expected = Buffer.from(`Bearer ${secret}`);
	const given = Buffer.from(header);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid dispatch secret");
	}

	return ok(await runDispatch());
}

internalRouter.get("/dispatch", handleDispatch);
internalRouter.post("/dispatch", handleDispatch);

