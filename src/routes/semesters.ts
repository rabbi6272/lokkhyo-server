import { Hono } from "hono";

import { created, noContent, ok, okPage, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { cascadeQuery, pageResponse } from "@/schemas/common";
import {
	createSemesterInput,
	semesterIdParams,
	semesterSchema,
	updateSemesterInput,
} from "@/schemas/semester";
import {
	activateSemester,
	createSemester,
	deleteSemester,
	getSemester,
	listSemesters,
	updateSemester,
} from "@/services/semester";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const semestersRouter = new Hono<AppEnv>();

semestersRouter.use("*", authMiddleware);

const semesterPage = pageResponse(semesterSchema);

semestersRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const page = await listSemesters(auth.uid, pageRequestFromUrl(url));
	return okPage(respondPage(semesterPage, page));
});

semestersRouter.post("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(createSemesterInput, await readJson(c.req.raw));
	const semester = await createSemester(auth.uid, input);
	return created(respond(semesterSchema, semester));
});

semestersRouter.get("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(semesterIdParams, { id: c.req.param("id") });
	return ok(respond(semesterSchema, await getSemester(auth.uid, id)));
});

semestersRouter.patch("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(semesterIdParams, { id: c.req.param("id") });
	const input = parseBody(updateSemesterInput, await readJson(c.req.raw));
	return ok(respond(semesterSchema, await updateSemester(auth.uid, id, input)));
});

semestersRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const { id } = parseParams(semesterIdParams, { id: c.req.param("id") });
	const { cascade } = parseQuery(cascadeQuery, {
		cascade: url.searchParams.get("cascade") ?? undefined,
	});
	await deleteSemester(auth.uid, id, cascade);
	return noContent();
});

semestersRouter.post("/:id/activate", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(semesterIdParams, { id: c.req.param("id") });
	return ok(respond(semesterSchema, await activateSemester(auth.uid, id)));
});

