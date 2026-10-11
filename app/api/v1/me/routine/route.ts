import { z } from "zod";

import { ok, parseQuery } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { routineQuery, scheduledClassSchema } from "@/schemas/course";
import { routineForDate } from "@/services/course";

/**
 * `GET /api/v1/me/routine`
 *
 * The student's day view, across every course, sorted by start time — the one
 * routine read the app cannot build from `GET /courses/:id/routine` alone, since
 * that returns one course's slots and a day view needs them merged.
 *
 * "Today" is resolved in the profile's IANA timezone, not the server's: a
 * student in Dhaka asking at 01:00 local must get Friday's classes even though
 * UTC has already rolled to Saturday. Pass `?date=YYYY-MM-DD` to look ahead.
 *
 * A day with no classes returns `[]` rather than 404 — an empty timetable is a
 * legitimate weekend, not a missing resource.
 */
export const GET = route(async ({ auth, query }) => {
	const { date } = parseQuery(routineQuery, { date: query.get("date") ?? undefined });
	const classes = await routineForDate(auth.uid, auth.user.timezone, date);
	return ok(respond(z.array(scheduledClassSchema), classes));
});
