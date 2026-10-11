import { created, okPage, parseBody, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { resultWithFlagSchema, resultWriteResponseSchema } from "@/schemas/grade";
import { createResultInput, listResultsQuery } from "@/schemas/result";
import { createResult, listResults } from "@/services/result";
import { withIdempotency } from "@/lib/idempotency";

const resultPage = pageResponse(resultWithFlagSchema);

export const GET = route(async ({ auth, request, query }) => {
	const filters = parseQuery(listResultsQuery, {
		courseId: query.get("courseId") ?? undefined,
		semesterId: query.get("semesterId") ?? undefined,
	});
	const page = await listResults(
		auth.uid,
		pageRequestFromUrl(new URL(request.url)),
		filters,
	);
	return okPage(respondPage(resultPage, page));
});

/**
 * `POST /api/v1/results`
 *
 * Requires an `Idempotency-Key`, and needs one: recording a result is not a
 * natural-key upsert the way marking attendance is. A retried POST would create
 * a second attempt, which is a real change to the academic record and would
 * move the CGPA.
 *
 * The recomputed GPA is returned in the same response. The moment a grade is
 * entered is exactly when a stale CGPA on screen would be most confusing, and
 * a second round trip is the likeliest thing to be skipped.
 */
export const POST = route(async ({ auth, request }) => {
	const input = parseBody(createResultInput, await readJson(request));

	return withIdempotency(request, auth.uid, input, async () => {
		const outcome = await createResult(auth.uid, input);
		return created(respond(resultWriteResponseSchema, outcome));
	});
});
