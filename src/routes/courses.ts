import { Hono } from "hono";

import { created, noContent, ok, okPage, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { cascadeQuery, pageResponse } from "@/schemas/common";
import {
	courseIdParams,
	courseSchema,
	createCourseInput,
	listCoursesQuery,
	replaceRoutineInput,
	routineSchema,
	updateCourseInput,
} from "@/schemas/course";
import {
	attendanceSchema,
	attendanceSummarySchema,
	listAttendanceQuery,
	putAttendanceInput,
} from "@/schemas/attendance";
import {
	createCourse,
	deleteCourse,
	getCourse,
	listCourses,
	listRoutine,
	replaceRoutine,
	updateCourse,
} from "@/services/course";
import { attendanceSummary, listAttendance, putAttendance } from "@/services/attendance";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const coursesRouter = new Hono<AppEnv>();

coursesRouter.use("*", authMiddleware);

const coursePage = pageResponse(courseSchema);
const attendancePage = pageResponse(attendanceSchema);

// Course collection
coursesRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const page = pageRequestFromUrl(url);
	const filters = parseQuery(listCoursesQuery, {
		courseId: undefined,
		semesterId: url.searchParams.get("semesterId") ?? undefined,
	});
	return okPage(respondPage(coursePage, await listCourses(auth.uid, page, filters)));
});

coursesRouter.post("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(createCourseInput, await readJson(c.req.raw));
	return created(respond(courseSchema, await createCourse(auth.uid, input)));
});

// Single course
coursesRouter.get("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	return ok(respond(courseSchema, await getCourse(auth.uid, id)));
});

coursesRouter.patch("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	const input = parseBody(updateCourseInput, await readJson(c.req.raw));
	return ok(respond(courseSchema, await updateCourse(auth.uid, id, input)));
});

coursesRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	const { cascade } = parseQuery(cascadeQuery, {
		cascade: url.searchParams.get("cascade") ?? undefined,
	});
	await deleteCourse(auth.uid, id, cascade);
	return noContent();
});

// Routine slots for course
coursesRouter.get("/:id/routine", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	return ok(respond(routineSchema, await listRoutine(auth.uid, id)));
});

coursesRouter.put("/:id/routine", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	const input = parseBody(replaceRoutineInput, await readJson(c.req.raw));
	return ok(respond(routineSchema, await replaceRoutine(auth.uid, id, input.slots)));
});

// Attendance for course
coursesRouter.get("/:id/attendance", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	const filters = parseQuery(listAttendanceQuery, {
		courseId: id,
		from: url.searchParams.get("from") ?? undefined,
		to: url.searchParams.get("to") ?? undefined,
	});
	const page = await listAttendance(auth.uid, pageRequestFromUrl(url), filters);
	return okPage(respondPage(attendancePage, page));
});

coursesRouter.put("/:id/attendance", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	const input = parseBody(putAttendanceInput, await readJson(c.req.raw));
	return ok(respond(attendanceSchema, await putAttendance(auth.uid, id, input)));
});

coursesRouter.get("/:id/attendance/summary", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(courseIdParams, { id: c.req.param("id") });
	const rollup = await attendanceSummary(auth.uid, id, auth.user.timezone);
	return ok(respond(attendanceSummarySchema, rollup));
});

