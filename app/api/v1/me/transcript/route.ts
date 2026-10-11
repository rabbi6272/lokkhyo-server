import { ok } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { transcriptSchema } from "@/schemas/result";
import { transcript } from "@/services/grade";

/**
 * `GET /api/v1/me/transcript`
 *
 * One entry per course with every attempt nested, so a retake reads as a
 * retake rather than as a second course. Superseded attempts are retained.
 */
export const GET = route(async ({ auth }) => {
	return ok(respond(transcriptSchema, await transcript(auth.uid)));
});
