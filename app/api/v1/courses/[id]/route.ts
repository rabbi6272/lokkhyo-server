import { noContent, ok, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { cascadeQuery } from "@/schemas/common";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { courseIdParams, courseSchema, updateCourseInput } from "@/schemas/course";
import { deleteCourse, getCourse, updateCourse } from "@/services/course";

export const GET = route(async ({ auth, params }) => {
	const { id } = parseParams(courseIdParams, params);
	return ok(respond(courseSchema, await getCourse(auth.uid, id)));
});

export const PATCH = route(async ({ auth, params, request }) => {
	const { id } = parseParams(courseIdParams, params);
	const input = parseBody(updateCourseInput, await readJson(request));
	return ok(respond(courseSchema, await updateCourse(auth.uid, id, input)));
});

/**
 * A course carries attendance, assessments and results, so a bare delete is
 * refused with 409 and a cascade is opt-in. The CGPA is recomputed either way:
 * the aggregate is derived from results, so removing results must move it.
 */
export const DELETE = route(async ({ auth, params, query }) => {
	const { id } = parseParams(courseIdParams, params);
	const { cascade } = parseQuery(cascadeQuery, {
		cascade: query.get("cascade") ?? undefined,
	});
	await deleteCourse(auth.uid, id, cascade);
	return noContent();
});
