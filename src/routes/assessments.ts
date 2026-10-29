import { Hono } from "hono";

import { created, noContent, ok, okPage, parseBody, parseParams, parseQuery, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { cascadeQuery, pageResponse } from "@/schemas/common";
import {
	assessmentIdParams,
	assessmentSchema,
	createAssessmentInput,
	listAssessmentsQuery,
	updateAssessmentInput,
} from "@/schemas/assessment";
import {
	createAssessment,
	deleteAssessment,
	getAssessment,
	listAssessments,
	updateAssessment,
} from "@/services/assessment";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const assessmentsRouter = new Hono<AppEnv>();

assessmentsRouter.use("*", authMiddleware);

const assessmentPage = pageResponse(assessmentSchema);

assessmentsRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const filters = parseQuery(listAssessmentsQuery, {
		courseId: url.searchParams.get("courseId") ?? undefined,
		upcoming: url.searchParams.get("upcoming") ?? undefined,
	});
	const page = await listAssessments(auth.uid, pageRequestFromUrl(url), filters);
	return okPage(respondPage(assessmentPage, page));
});

assessmentsRouter.post("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(createAssessmentInput, await readJson(c.req.raw));
	return created(respond(assessmentSchema, await createAssessment(auth.uid, input)));
});

assessmentsRouter.get("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(assessmentIdParams, { id: c.req.param("id") });
	return ok(respond(assessmentSchema, await getAssessment(auth.uid, id)));
});

assessmentsRouter.patch("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(assessmentIdParams, { id: c.req.param("id") });
	const input = parseBody(updateAssessmentInput, await readJson(c.req.raw));
	return ok(respond(assessmentSchema, await updateAssessment(auth.uid, id, input)));
});

assessmentsRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const { id } = parseParams(assessmentIdParams, { id: c.req.param("id") });
	const { cascade } = parseQuery(cascadeQuery, {
		cascade: url.searchParams.get("cascade") ?? undefined,
	});
	await deleteAssessment(auth.uid, id, cascade);
	return noContent();
});

