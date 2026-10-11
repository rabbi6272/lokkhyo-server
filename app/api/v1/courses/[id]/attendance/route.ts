import { ok, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { courseIdParams } from "@/schemas/course";
import {
	attendanceSchema,
	listAttendanceQuery,
	putAttendanceInput,
} from "@/schemas/attendance";
import { listAttendance, putAttendance } from "@/services/attendance";

const attendancePage = pageResponse(attendanceSchema);

export const GET = route(async ({ auth, params, request, query }) => {
	const { id } = parseParams(courseIdParams, params);
	// Scoped to the course in the path. Passing `undefined` here would have
	// silently returned every course's attendance under a course-scoped URL.
	const filters = parseQuery(listAttendanceQuery, {
		courseId: id,
		from: query.get("from") ?? undefined,
		to: query.get("to") ?? undefined,
	});
	const page = await listAttendance(
		auth.uid,
		pageRequestFromUrl(new URL(request.url)),
		filters,
	);
	return ok(respondPage(attendancePage, page));
});

/**
 * `PUT /api/v1/courses/:id/attendance`
 *
 * The natural key is `(courseId, date)`, so re-marking a session overwrites one
 * row rather than appending. That is why marking attendance needs no
 * `Idempotency-Key` while recording a result does: a retried mark is incapable
 * of creating a second record.
 */
export const PUT = route(async ({ auth, params, request }) => {
	const { id } = parseParams(courseIdParams, params);
	const input = parseBody(putAttendanceInput, await readJson(request));
	return ok(respond(attendanceSchema, await putAttendance(auth.uid, id, input)));
});
