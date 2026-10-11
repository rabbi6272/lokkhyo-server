import { created, okPage, parseBody, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import {
	createDeadlineInput,
	deadlineSchema,
	listDeadlinesQuery,
} from "@/schemas/deadline";
import { createDeadline, listDeadlines } from "@/services/deadline";

const deadlinePage = pageResponse(deadlineSchema);

export const GET = route(async ({ auth, request, query }) => {
	const filters = parseQuery(listDeadlinesQuery, {
		courseId: query.get("courseId") ?? undefined,
		type: query.get("type") ?? undefined,
		upcoming: query.get("upcoming") ?? undefined,
		from: query.get("from") ?? undefined,
		to: query.get("to") ?? undefined,
	});
	const page = await listDeadlines(
		auth.uid,
		pageRequestFromUrl(new URL(request.url)),
		filters,
	);
	return okPage(respondPage(deadlinePage, page));
});

/**
 * No idempotency key: a deadline is created from its own title and due date, so
 * an exact duplicate is a client mistake the unique index can report, not a
 * retry to be replayed.
 */
export const POST = route(async ({ auth, request }) => {
	const input = parseBody(createDeadlineInput, await readJson(request));
	return created(respond(deadlineSchema, await createDeadline(auth.uid, input)));
});
