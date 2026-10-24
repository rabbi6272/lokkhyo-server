import { Hono } from "hono";
import { z } from "zod";

import { ok, okPage, parseBody, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import {
	listNotificationsQuery,
	markNotificationsReadInput,
	notificationSchema,
} from "@/schemas/notification";
import { listNotifications, markNotificationsRead } from "@/services/notification";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const notificationsRouter = new Hono<AppEnv>();

notificationsRouter.use("*", authMiddleware);

const notificationPage = pageResponse(notificationSchema);
const readResultSchema = z.object({ updated: z.number().int().nonnegative() });

notificationsRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const filters = parseQuery(listNotificationsQuery, {
		category: url.searchParams.get("category") ?? undefined,
		unreadOnly: url.searchParams.get("unreadOnly") ?? undefined,
	});
	const page = await listNotifications(auth.uid, pageRequestFromUrl(url), filters);
	return okPage(respondPage(notificationPage, page));
});

notificationsRouter.post("/read", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(markNotificationsReadInput, await readJson(c.req.raw));
	return ok(respond(readResultSchema, await markNotificationsRead(auth.uid, input)));
});

