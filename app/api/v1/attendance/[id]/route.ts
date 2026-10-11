import { noContent, ok, parseBody, parseParams, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { amendAttendanceInput, attendanceIdParams, attendanceSchema } from "@/schemas/attendance";
import { deleteAttendance, updateAttendance } from "@/services/attendance";

/**
 * Amend a single marked session.
 *
 * Reached through `/attendance/:id` rather than the course sub-resource: once a
 * record exists it has its own identity, and the date is not editable — it is
 * part of what makes the record the record.
 */
export const PATCH = route(async ({ auth, params, request }) => {
	const { id } = parseParams(attendanceIdParams, params);
	const input = parseBody(amendAttendanceInput, await readJson(request));
	return ok(respond(attendanceSchema, await updateAttendance(auth.uid, id, input)));
});

export const DELETE = route(async ({ auth, params }) => {
	const { id } = parseParams(attendanceIdParams, params);
	await deleteAttendance(auth.uid, id);
	return noContent();
});
