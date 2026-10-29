import { Hono } from "hono";

import { created, noContent, ok, okPage, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import {
	createDeadlineInput,
	deadlineIdParams,
	deadlineSchema,
	listDeadlinesQuery,
	updateDeadlineInput,
} from "@/schemas/deadline";
import {
	createDeadline,
	deleteDeadline,
	getDeadline,
	listDeadlines,
	updateDeadline,
} from "@/services/deadline";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const deadlinesRouter = new Hono<AppEnv>();

deadlinesRouter.use("*", authMiddleware);

const deadlinePage = pageResponse(deadlineSchema);

deadlinesRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const filters = parseQuery(listDeadlinesQuery, {
		courseId: url.searchParams.get("courseId") ?? undefined,
		type: url.searchParams.get("type") ?? undefined,
		upcoming: url.searchParams.get("upcoming") ?? undefined,
		from: url.searchParams.get("from") ?? undefined,
		to: url.searchParams.get("to") ?? undefined,
	});
	const page = await listDeadlines(auth.uid, pageRequestFromUrl(url), filters);
	return okPage(respondPage(deadlinePage, page));
});

deadlinesRouter.post("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(createDeadlineInput, await readJson(c.req.raw));
	return created(respond(deadlineSchema, await createDeadline(auth.uid, input)));
});

deadlinesRouter.get("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(deadlineIdParams, { id: c.req.param("id") });
	return ok(respond(deadlineSchema, await getDeadline(auth.uid, id)));
});

deadlinesRouter.patch("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(deadlineIdParams, { id: c.req.param("id") });
	const input = parseBody(updateDeadlineInput, await readJson(c.req.raw));
	return ok(respond(deadlineSchema, await updateDeadline(auth.uid, id, input)));
});

deadlinesRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(deadlineIdParams, { id: c.req.param("id") });
	await deleteDeadline(auth.uid, id);
	return noContent();
});

