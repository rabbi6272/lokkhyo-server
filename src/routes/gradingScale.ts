import { Hono } from "hono";

import { gradingScaleDto } from "@/lib/grading";
import { ok } from "@/lib/http";
import { respond } from "@/lib/serialize";
import { gradingScaleSchema } from "@/schemas/grade";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const gradingScaleRouter = new Hono<AppEnv>();

gradingScaleRouter.use("*", authMiddleware);

gradingScaleRouter.get("/", () => {
	return ok(respond(gradingScaleSchema, gradingScaleDto()));
});

