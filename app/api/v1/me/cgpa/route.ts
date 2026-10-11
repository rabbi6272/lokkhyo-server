import { ok } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { cgpaSchema } from "@/schemas/grade";
import { readCumulative } from "@/services/gpa";

/**
 * `GET /api/v1/me/cgpa`
 *
 * Reads the stored cumulative. The recompute happens on write to a result, so
 * this is a point read: the same request a second later returns the same number.
 * Classification and backlog counts live on `/me/degree-status`.
 */
export const GET = route(async ({ auth }) => {
	return ok(respond(cgpaSchema, await readCumulative(auth.uid)));
});
