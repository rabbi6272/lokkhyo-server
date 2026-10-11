import { created, okPage, parseBody, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import {
	assessmentSchema,
	createAssessmentInput,
	listAssessmentsQuery,
} from "@/schemas/assessment";
import { createAssessment, listAssessments } from "@/services/assessment";

const assessmentPage = pageResponse(assessmentSchema);

export const GET = route(async ({ auth, request, query }) => {
	const filters = parseQuery(listAssessmentsQuery, {
		courseId: query.get("courseId") ?? undefined,
		upcoming: query.get("upcoming") ?? undefined,
	});
	const page = await listAssessments(
		auth.uid,
		pageRequestFromUrl(new URL(request.url)),
		filters,
	);
	return okPage(respondPage(assessmentPage, page));
});

export const POST = route(async ({ auth, request }) => {
	const input = parseBody(createAssessmentInput, await readJson(request));
	return created(respond(assessmentSchema, await createAssessment(auth.uid, input)));
});
