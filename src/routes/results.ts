import { Hono } from "hono";

import { withIdempotency } from "@/lib/idempotency";
import { created, noContent, ok, okPage, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { resultWithFlagSchema, resultWriteResponseSchema } from "@/schemas/grade";
import {
	createResultInput,
	listResultsQuery,
	resultIdParams,
	updateResultInput,
} from "@/schemas/result";
import { createResult, deleteResult, listResults, updateResult } from "@/services/result";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const resultsRouter = new Hono<AppEnv>();

resultsRouter.use("*", authMiddleware);

const resultPage = pageResponse(resultWithFlagSchema);

resultsRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const filters = parseQuery(listResultsQuery, {
		courseId: url.searchParams.get("courseId") ?? undefined,
		semesterId: url.searchParams.get("semesterId") ?? undefined,
	});
	const page = await listResults(auth.uid, pageRequestFromUrl(url), filters);
	return okPage(respondPage(resultPage, page));
});

resultsRouter.post("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(createResultInput, await readJson(c.req.raw));

	return withIdempotency(c.req.raw, auth.uid, input, async () => {
		const outcome = await createResult(auth.uid, input);
		return created(respond(resultWriteResponseSchema, outcome));
	});
});

resultsRouter.put("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(resultIdParams, { id: c.req.param("id") });
	const input = parseBody(updateResultInput, await readJson(c.req.raw));
	const outcome = await updateResult(auth.uid, id, input);
	return ok(respond(resultWriteResponseSchema, outcome));
});

resultsRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(resultIdParams, { id: c.req.param("id") });
	await deleteResult(auth.uid, id);
	return noContent();
});

