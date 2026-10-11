import { noContent, ok, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { cascadeQuery } from "@/schemas/common";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import {
	semesterIdParams,
	semesterSchema,
	updateSemesterInput,
} from "@/schemas/semester";
import { deleteSemester, getSemester, updateSemester } from "@/services/semester";

/**
 * `GET /api/v1/semesters/:id`
 *
 * Every query is scoped by `userId`, so another student's id returns 404 rather
 * than 403 — confirming that an id exists is itself a leak.
 */
export const GET = route(async ({ auth, params }) => {
	const { id } = parseParams(semesterIdParams, params);
	return ok(respond(semesterSchema, await getSemester(auth.uid, id)));
});

export const PATCH = route(async ({ auth, params, request }) => {
	const { id } = parseParams(semesterIdParams, params);
	const input = parseBody(updateSemesterInput, await readJson(request));
	return ok(respond(semesterSchema, await updateSemester(auth.uid, id, input)));
});

/**
 * `DELETE /api/v1/semesters/:id?cascade=true`
 *
 * Refuses with 409 when courses still reference the term. A cascade would move
 * the student's CGPA with no visible cause, so it has to be asked for by name
 * rather than inferred.
 */
export const DELETE = route(async ({ auth, params, query }) => {
	const { id } = parseParams(semesterIdParams, params);
	const { cascade } = parseQuery(cascadeQuery, {
		cascade: query.get("cascade") ?? undefined,
	});
	await deleteSemester(auth.uid, id, cascade);
	return noContent();
});
