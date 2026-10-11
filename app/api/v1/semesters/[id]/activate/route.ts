import { ok, parseParams } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { semesterIdParams, semesterSchema } from "@/schemas/semester";
import { activateSemester } from "@/services/semester";

/**
 * `POST /api/v1/semesters/:id/activate`
 *
 * Archives every other active term, activates this one, and points the
 * profile's `currentSemesterId` at it. Naturally idempotent: activating the
 * already-active semester changes nothing.
 */
export const POST = route(async ({ auth, params }) => {
	const { id } = parseParams(semesterIdParams, params);
	return ok(respond(semesterSchema, await activateSemester(auth.uid, id)));
});
