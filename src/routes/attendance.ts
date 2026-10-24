import { Hono } from "hono";

import { noContent, ok, parseBody, parseParams, readJson } from "@/lib/http";
import { respond } from "@/lib/serialize";
import { amendAttendanceInput, attendanceIdParams, attendanceSchema } from "@/schemas/attendance";
import { deleteAttendance, updateAttendance } from "@/services/attendance";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const attendanceRouter = new Hono<AppEnv>();

attendanceRouter.use("*", authMiddleware);

attendanceRouter.patch("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(attendanceIdParams, { id: c.req.param("id") });
	const input = parseBody(amendAttendanceInput, await readJson(c.req.raw));
	return ok(respond(attendanceSchema, await updateAttendance(auth.uid, id, input)));
});

attendanceRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(attendanceIdParams, { id: c.req.param("id") });
	await deleteAttendance(auth.uid, id);
	return noContent();
});

