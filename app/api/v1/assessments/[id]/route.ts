import { noContent, ok, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { cascadeQuery } from "@/schemas/common";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import {
	assessmentIdParams,
	assessmentSchema,
	updateAssessmentInput,
} from "@/schemas/assessment";
import { deleteAssessment, getAssessment, updateAssessment } from "@/services/assessment";

export const GET = route(async ({ auth, params }) => {
	const { id } = parseParams(assessmentIdParams, params);
	return ok(respond(assessmentSchema, await getAssessment(auth.uid, id)));
});

/**
 * Changing `maxMarks` re-derives nothing on its own. The recorded percentages
 * stay as they were: the transcript is a record of what was awarded, not a live
 * recalculation against a later maximum. Regrading is a separate, explicit
 * write to the result.
 */
export const PATCH = route(async ({ auth, params, request }) => {
	const { id } = parseParams(assessmentIdParams, params);
	const input = parseBody(updateAssessmentInput, await readJson(request));
	return ok(respond(assessmentSchema, await updateAssessment(auth.uid, id, input)));
});

/**
 * Refuses with 409 when results exist, since deleting the assessment would
 * orphan marks. A cascade removes the results and recomputes the GPA, so the
 * aggregate can never outlive the rows it was derived from.
 */
export const DELETE = route(async ({ auth, params, query }) => {
	const { id } = parseParams(assessmentIdParams, params);
	const { cascade } = parseQuery(cascadeQuery, {
		cascade: query.get("cascade") ?? undefined,
	});
	await deleteAssessment(auth.uid, id, cascade);
	return noContent();
});
