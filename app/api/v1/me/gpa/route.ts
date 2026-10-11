import { ok, parseQuery } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { gpaQuery } from "@/schemas/result";
import { semesterGpaSchema } from "@/schemas/grade";
import { gpaForSemester } from "@/services/grade";

/**
 * `GET /api/v1/me/gpa?semesterId=`
 *
 * `semesterId` is required rather than defaulting: "the GPA" is ambiguous, and
 * silently answering with the cumulative when a student asked about a term
 * would be a wrong number presented confidently.
 */
export const GET = route(async ({ auth, query }) => {
	const { semesterId } = parseQuery(gpaQuery, {
		semesterId: query.get("semesterId") ?? undefined,
	});

	if (!semesterId) {
		throw badRequest(
			"semesterId is required. Use /api/v1/me/cgpa for the cumulative.",
		);
	}

	return ok(
		respond(semesterGpaSchema, await gpaForSemester(auth.uid, semesterId)),
	);
});

