import { ok, parseBody, parseParams, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { courseIdParams, replaceRoutineInput, routineSchema } from "@/schemas/course";
import { listRoutine, replaceRoutine } from "@/services/course";

/** The course's full weekly slot set. */
export const GET = route(async ({ auth, params }) => {
	const { id } = parseParams(courseIdParams, params);
	return ok(respond(routineSchema, await listRoutine(auth.uid, id)));
});

/**
 * `PUT` replaces the whole set.
 *
 * A timetable is a bounded document, not a partial edit: the client always knows
 * the complete schedule. Replace-semantics is both simpler than per-slot
 * add/remove and naturally idempotent, so this needs no `Idempotency-Key`.
 */
export const PUT = route(async ({ auth, params, request }) => {
	const { id } = parseParams(courseIdParams, params);
	const input = parseBody(replaceRoutineInput, await readJson(request));
	return ok(respond(routineSchema, await replaceRoutine(auth.uid, id, input.slots)));
});
