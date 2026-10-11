import { ok } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { degreeStatusSchema } from "@/schemas/result";
import { degreeStatus } from "@/services/grade";

/**
 * `GET /api/v1/me/cgpa`
 *
 * Reads the stored cumulative. The recompute happens on write to a result, so
 * this is a point read: the same request a second later returns the same number.
 */
export const GET = route(async ({ auth }) => {
	return ok(respond(degreeStatusSchema, await degreeStatus(auth.uid)));
});
