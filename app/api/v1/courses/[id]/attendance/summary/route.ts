import { ok, parseParams } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { courseIdParams } from "@/schemas/course";
import { attendanceSummarySchema } from "@/schemas/attendance";
import { attendanceSummary } from "@/services/attendance";

/**
 * `GET /api/v1/courses/:id/attendance/summary`
 *
 * The caller's own timezone decides what "today" means for `pendingSessions`.
 * A student in Dhaka at 01:00 local is not yet in tomorrow even though UTC has
 * already moved on, and marking their last session as final would be wrong.
 */
export const GET = route(async ({ auth, params }) => {
	const { id } = parseParams(courseIdParams, params);
	const rollup = await attendanceSummary(auth.uid, id, auth.user.timezone);
	return ok(respond(attendanceSummarySchema, rollup));
});
