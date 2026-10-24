import { Hono } from "hono";

import { errorHandler } from "@/src/middleware/error";
import { loggingMiddleware } from "@/src/middleware/logging";
import { assessmentsRouter } from "@/src/routes/assessments";
import { attendanceRouter } from "@/src/routes/attendance";
import { coursesRouter } from "@/src/routes/courses";
import { deadlinesRouter } from "@/src/routes/deadlines";
import { devicesRouter } from "@/src/routes/devices";
import { gradingScaleRouter } from "@/src/routes/gradingScale";
import { healthRouter } from "@/src/routes/health";
import { internalRouter } from "@/src/routes/internal";
import { meRouter } from "@/src/routes/me";
import { notificationsRouter } from "@/src/routes/notifications";
import { resultsRouter } from "@/src/routes/results";
import { semestersRouter } from "@/src/routes/semesters";
import type { AppEnv } from "@/src/types";

export function createHonoApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	// Global error handler
	app.onError(errorHandler);

	// Global logging middleware
	app.use("*", loggingMiddleware);

	// Root health check for Render container probes
	app.get("/health", (c) => c.json({ status: "healthy" }));

	// API v1 router
	const v1 = new Hono<AppEnv>();

	v1.route("/health", healthRouter);
	v1.route("/grading-scale", gradingScaleRouter);
	v1.route("/me", meRouter);
	v1.route("/courses", coursesRouter);
	v1.route("/semesters", semestersRouter);
	v1.route("/attendance", attendanceRouter);
	v1.route("/assessments", assessmentsRouter);
	v1.route("/results", resultsRouter);
	v1.route("/deadlines", deadlinesRouter);
	v1.route("/notifications", notificationsRouter);
	v1.route("/devices", devicesRouter);
	v1.route("/internal", internalRouter);

	// Mount under /api/v1
	app.route("/api/v1", v1);

	return app;
}

export const app = createHonoApp();

