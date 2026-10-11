import { created, okPage, parseBody, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { createSemesterInput, semesterSchema } from "@/schemas/semester";
import { pageResponse } from "@/schemas/common";
import { createSemester, listSemesters } from "@/services/semester";

const semesterPage = pageResponse(semesterSchema);

/**
 * `GET /api/v1/semesters`
 *
 * Newest first, cursor paginated. `parseQuery` on the limit is what rejects
 * `?limit=9999` with a 400 rather than quietly returning a different number of
 * rows than the client asked for.
 */
export const GET = route(async ({ auth, request }) => {
	const page = listSemesters(auth.uid, pageRequestFromUrl(new URL(request.url)));
	return okPage(respondPage(semesterPage, await page));
});

/**
 * `POST /api/v1/semesters`
 *
 * No idempotency key: creating the same named semester twice produces two
 * semesters, which is a client mistake rather than a retry, and the 409 from
 * the unique index is a clearer answer than a replay would be.
 */
export const POST = route(async ({ auth, request }) => {
	const input = parseBody(createSemesterInput, await readJson(request));
	const semester = await createSemester(auth.uid, input);
	return created(respond(semesterSchema, semester));
});
