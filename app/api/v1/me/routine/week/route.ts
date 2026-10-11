import { z } from "zod";

import { ok } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { scheduledClassSchema } from "@/schemas/course";
import { routineWeek } from "@/services/course";

/**
 * `GET /api/v1/me/routine/week`
 *
 * The full weekly timetable across every course, in weekday then start-time
 * order, each slot joined to its course. The week grid needs every slot at
 * once; fetching each course's routine separately would be one request per
 * course for the same data.
 */
export const GET = route(async ({ auth }) => {
	return ok(respond(z.array(scheduledClassSchema), await routineWeek(auth.uid)));
});
