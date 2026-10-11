import { created, okPage, parseBody, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { courseSchema, createCourseInput, listCoursesQuery } from "@/schemas/course";
import { createCourse, listCourses } from "@/services/course";

const coursePage = pageResponse(courseSchema);

export const GET = route(async ({ auth, request, query }) => {
	const page = pageRequestFromUrl(new URL(request.url));
	const filters = parseQuery(listCoursesQuery, {
		courseId: undefined,
		semesterId: query.get("semesterId") ?? undefined,
	});
	return okPage(respondPage(coursePage, await listCourses(auth.uid, page, filters)));
});

export const POST = route(async ({ auth, request }) => {
	const input = parseBody(createCourseInput, await readJson(request));
	return created(respond(courseSchema, await createCourse(auth.uid, input)));
});
