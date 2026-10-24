import { Hono } from "hono";
import { z } from "zod";

import { badRequest, internal } from "@/lib/errors";
import { noContent, ok, parseBody, parseQuery, readFormData, readJson } from "@/lib/http";
import { PHOTO_FIELD } from "@/lib/photo";
import { respond } from "@/lib/serialize";
import { User as UserModel } from "@/models";
import { cgpaSchema, semesterGpaSchema } from "@/schemas/grade";
import { routineQuery, scheduledClassSchema } from "@/schemas/course";
import { degreeStatusSchema, gpaQuery, transcriptSchema } from "@/schemas/result";
import {
	notificationPrefsSchema,
	updateMeInput,
	updateNotificationPrefsInput,
	userSchema,
} from "@/schemas/user";
import { deleteAccount } from "@/services/account";
import { routineForDate, routineWeek } from "@/services/course";
import { readCumulative } from "@/services/gpa";
import { degreeStatus, gpaForSemester, transcript } from "@/services/grade";
import { getNotificationPrefs, updateNotificationPrefs } from "@/services/notification";
import { clearProfilePhoto, setProfilePhoto } from "@/services/photo";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const meRouter = new Hono<AppEnv>();

meRouter.use("*", authMiddleware);

// Profile
meRouter.get("/", (c) => {
	const auth = c.get("auth");
	return ok(respond(userSchema, auth.user));
});

meRouter.patch("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(updateMeInput, await readJson(c.req.raw));

	const updated = await UserModel.findOneAndUpdate(
		{ firebaseUid: auth.uid },
		{ $set: input },
		{ returnDocument: "after" },
	).lean();

	if (!updated) {
		throw internal("Profile is missing for an authenticated user");
	}

	return ok(respond(userSchema, updated));
});

meRouter.delete("/", async (c) => {
	const auth = c.get("auth");
	await deleteAccount(auth.uid, auth.user.photoUrl ?? null);
	return noContent();
});

// CGPA & GPA
meRouter.get("/cgpa", async (c) => {
	const auth = c.get("auth");
	return ok(respond(cgpaSchema, await readCumulative(auth.uid)));
});

meRouter.get("/gpa", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const { semesterId } = parseQuery(gpaQuery, {
		semesterId: url.searchParams.get("semesterId") ?? undefined,
	});

	if (!semesterId) {
		throw badRequest("semesterId is required. Use /api/v1/me/cgpa for the cumulative.");
	}

	return ok(respond(semesterGpaSchema, await gpaForSemester(auth.uid, semesterId)));
});

// Transcript & Degree Status
meRouter.get("/transcript", async (c) => {
	const auth = c.get("auth");
	return ok(respond(transcriptSchema, await transcript(auth.uid)));
});

meRouter.get("/degree-status", async (c) => {
	const auth = c.get("auth");
	return ok(respond(degreeStatusSchema, await degreeStatus(auth.uid)));
});

// Notification Preferences
meRouter.get("/notification-prefs", async (c) => {
	const auth = c.get("auth");
	return ok(respond(notificationPrefsSchema, await getNotificationPrefs(auth.uid)));
});

meRouter.patch("/notification-prefs", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(updateNotificationPrefsInput, await readJson(c.req.raw));
	return ok(respond(notificationPrefsSchema, await updateNotificationPrefs(auth.uid, input)));
});

// Routine
meRouter.get("/routine", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const { date } = parseQuery(routineQuery, {
		date: url.searchParams.get("date") ?? undefined,
	});
	const classes = await routineForDate(auth.uid, auth.user.timezone, date);
	return ok(respond(z.array(scheduledClassSchema), classes));
});

meRouter.get("/routine/week", async (c) => {
	const auth = c.get("auth");
	return ok(respond(z.array(scheduledClassSchema), await routineWeek(auth.uid)));
});

// Photo
meRouter.put("/photo", async (c) => {
	const auth = c.get("auth");
	const form = await readFormData(c.req.raw);
	const file = form.get(PHOTO_FIELD);

	if (!(file instanceof File) || file.size === 0) {
		throw badRequest(
			`No file provided. Send a non-empty file as the multipart part named '${PHOTO_FIELD}'.`,
		);
	}

	return ok(respond(userSchema, await setProfilePhoto(auth.uid, file)));
});

meRouter.delete("/photo", async (c) => {
	const auth = c.get("auth");
	await clearProfilePhoto(auth.uid);
	return noContent();
});

