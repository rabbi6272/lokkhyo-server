import { ok } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { degreeStatusSchema } from "@/schemas/result";
import { degreeStatus } from "@/services/grade";

/**
 * `GET /api/v1/me/degree-status`
 *
 * Classification plus the actionable part: which courses a student below the
 * threshold may still repeat. Derived on read so the list cannot disagree with
 * the CGPA printed beside it.
 */
export const GET = route(async ({ auth }) => {
	return ok(respond(degreeStatusSchema, await degreeStatus(auth.uid)));
});
