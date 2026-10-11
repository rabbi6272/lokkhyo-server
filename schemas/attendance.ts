import { z } from "zod";

import {
	attendanceStatus,
	AttendanceIdSchema,
	calendarDate,
	CourseIdSchema,
	isoDateTime,
	pageResponse,
	percentage,
} from "@/schemas/common";

export const attendanceSchema = z.object({
	id: AttendanceIdSchema,
	courseId: CourseIdSchema,
	/** Calendar date of the session, `YYYY-MM-DD`. */
	date: calendarDate,
	slotId: z.string().nullable().default(null),
	status: attendanceStatus,
	note: z.string().max(280).nullable(),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Attendance = z.infer<typeof attendanceSchema>;

/**
 * Mark a session for a course.
 *
 * `courseId` is absent because it is in the path. Repeating it in the body
 * invites a request that marks the wrong course, and the server would have to
 * pick a winner between two disagreeing sources.
 */
export const putAttendanceInput = z.strictObject({
	date: calendarDate,
	/** A routine slot id of this course; omit for a course-day record. */
	slotId: z.string().regex(/^[a-f\d]{24}$/i, "Must be a routine slot id").nullable().optional(),
	status: attendanceStatus,
	note: z.string().max(280).optional(),
});

export type PutAttendanceInput = z.infer<typeof putAttendanceInput>;

/**
 * `PATCH` on a marked session: amend the status or note without restating the
 * date. The course and date identify the record, so neither is editable.
 */
export const amendAttendanceInput = z.strictObject({
	status: attendanceStatus.optional(),
	note: z.string().max(280).nullable().optional(),
});

export type AmendAttendanceInput = z.infer<typeof amendAttendanceInput>;

export const attendanceIdParams = z.object({ id: AttendanceIdSchema });
export type AttendanceIdParams = z.infer<typeof attendanceIdParams>;

export const listAttendanceQuery = z.object({
	courseId: CourseIdSchema.optional(),
	from: calendarDate.optional(),
	to: calendarDate.optional(),
});

export type ListAttendanceQuery = z.infer<typeof listAttendanceQuery>;

/**
 * Per-course attendance rollup.
 *
 * The four counts are all returned, not just a percentage. Whether LATE and
 * EXCUSED count toward eligibility is an institutional rule that varies, and a
 * client that receives only a pre-computed percentage has no way to apply a
 * stricter local policy without a server change. The `percentage` here is the
 * lenient default; the components are the source of truth.
 */
export const attendanceSummarySchema = z.object({
	courseId: CourseIdSchema,
	courseCode: z.string(),
	courseTitle: z.string(),
	totalSessions: z.number().int().nonnegative(),
	presentCount: z.number().int().nonnegative(),
	lateCount: z.number().int().nonnegative(),
	excusedCount: z.number().int().nonnegative(),
	absentCount: z.number().int().nonnegative(),
	cancelledCount: z.number().int().nonnegative().default(0),
	/** `null` when no sessions have been recorded yet. */
	percentage: percentage.nullable(),
	/** Sessions that may still be marked, i.e. today or later. */
	pendingSessions: z.number().int().nonnegative().default(0),
});

export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>;

export const attendanceSummaryPage = pageResponse(attendanceSummarySchema);
