import { noContent, ok, parseBody, parseParams, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { resultIdParams, updateResultInput } from "@/schemas/result";
import { resultWriteResponseSchema } from "@/schemas/grade";
import { deleteResult, updateResult } from "@/services/result";

/**
 * `PUT /api/v1/results/:id` — amend a recorded mark.
 *
 * No `Idempotency-Key`, unlike `POST`. The client sends the marks it wants to be
 * true, so a retry converges on the same state by construction: re-running the
 * same request is a no-op rather than a second effect.
 */
export const PUT = route(async ({ auth, params, request }) => {
	const { id } = parseParams(resultIdParams, params);
	const input = parseBody(updateResultInput, await readJson(request));
	const outcome = await updateResult(auth.uid, id, input);
	return ok(respond(resultWriteResponseSchema, outcome));
});

/**
 * Deleting the latest attempt promotes the previous one and recomputes, so the
 * course never silently drops out of the GPA when a mistaken entry is removed.
 */
export const DELETE = route(async ({ auth, params }) => {
	const { id } = parseParams(resultIdParams, params);
	await deleteResult(auth.uid, id);
	return noContent();
});
