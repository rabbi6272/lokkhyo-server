import { z } from "zod";

import { isoDateTime, UserIdSchema, userRole } from "@/schemas/common";

export const userSchema = z.object({
	id: UserIdSchema,
	email: z.string().nullable(),
	name: z.string().nullable(),
	photoUrl: z.string().nullable(),
	role: userRole,
	/** IANA zone, e.g. `Asia/Dhaka`. Drives every scheduled reminder. */
	timezone: z.string(),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type User = z.infer<typeof userSchema>;

export const updateMeInput = z.strictObject({
	name: z.string().min(1).max(120).optional(),
	timezone: z.string().min(1).max(64).optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeInput>;

const localTime = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a 24-hour HH:mm time");

export const notificationPrefsSchema = z.object({
	timezone: z.string(),
	morningRoutineTime: localTime,
	eveningAttendanceTime: localTime,
	/** Per-category opt-in. Absent keys are treated as enabled. */
	categoriesEnabled: z.object({
		ROUTINE: z.boolean(),
		ATTENDANCE: z.boolean(),
		ATTENDANCE_RISK: z.boolean(),
		DEADLINE: z.boolean(),
		GRADE: z.boolean(),
	}),
	/** Sessions held before this hour count as over; affects the evening digest. */
	attendanceCutoffHour: z.number().int().min(0).max(23),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateNotificationPrefsInput = z
	.strictObject({
		timezone: z.string().min(1).max(64).optional(),
		morningRoutineTime: localTime.optional(),
		eveningAttendanceTime: localTime.optional(),
		categoriesEnabled: z
			.object({
				ROUTINE: z.boolean().optional(),
				ATTENDANCE: z.boolean().optional(),
				ATTENDANCE_RISK: z.boolean().optional(),
				DEADLINE: z.boolean().optional(),
				GRADE: z.boolean().optional(),
			})
			.optional(),
		attendanceCutoffHour: z.number().int().min(0).max(23).optional(),
	})
	.partial();

export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsInput>;
