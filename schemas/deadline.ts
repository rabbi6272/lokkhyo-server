import { z } from "zod";

import {
	assessmentType,
	CourseIdSchema,
	DeadlineIdSchema,
	deadlineType,
	isoDateTime,
} from "@/schemas/common";

/**
 * A dated thing that warrants a reminder.
 *
 * Kept separate from `assessments` deliberately. An exam on the 20th and the
 * assignment due on the 15th are different instants, and registration or
 * withdrawal deadlines are not assessments at all. This collection also owns
 * `remindersSent`, which is why it exists rather than being derived: reminder
 * delivery state needs exactly one home, or a resend becomes possible.
 */
export const deadlineSchema = z.object({
	id: DeadlineIdSchema,
	type: deadlineType,
	courseId: CourseIdSchema.nullable(),
	/** Optional link when the deadline was created from an assessment. */
	assessmentId: z.string().nullable(),
	assessmentType: assessmentType.nullable().default(null),
	title: z.string(),
	/** UTC instant. Unlike routine slots, a deadline *is* an instant. */
	dueAt: isoDateTime,
	/** Offsets before `dueAt` at which to remind, in hours. */
	reminderLeadTimes: z.array(z.number().int().positive()),
	remindersSent: z.array(
		z.object({
			leadTimeHours: z.number().int().positive(),
			sentAt: isoDateTime,
		}),
	),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Deadline = z.infer<typeof deadlineSchema>;

export const createDeadlineInput = z.strictObject({
	type: deadlineType,
	courseId: CourseIdSchema.nullable().default(null),
	assessmentId: z.string().nullable().default(null),
	assessmentType: assessmentType.nullable().default(null),
	title: z.string().min(1).max(160),
	dueAt: isoDateTime,
	reminderLeadTimes: z
		.array(z.number().int().positive())
		.max(5)
		.default([72, 24]),
});

export type CreateDeadlineInput = z.infer<typeof createDeadlineInput>;

export const updateDeadlineInput = z
	.strictObject({
		type: deadlineType.optional(),
		assessmentType: assessmentType.nullable().optional(),
		title: z.string().min(1).max(160).optional(),
		dueAt: isoDateTime.optional(),
		reminderLeadTimes: z.array(z.number().int().positive()).max(5).optional(),
	})
	.partial();

export type UpdateDeadlineInput = z.infer<typeof updateDeadlineInput>;

export const deadlineIdParams = z.object({ id: DeadlineIdSchema });
export type DeadlineIdParams = z.infer<typeof deadlineIdParams>;

/**
 * Deadline list filters.
 *
 * `upcoming` defaults to `false`, not `true`: a student opening the deadline
 * screen wants their full list, including yesterday's assignment, and silently
 * hiding rows would look like data loss. A client that genuinely wants only
 * future items opts in.
 */
export const listDeadlinesQuery = z.object({
	courseId: CourseIdSchema.optional(),
	type: deadlineType.optional(),
	upcoming: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default(false),
	/** Inclusive lower bound on `dueAt`. */
	from: isoDateTime.optional(),
	/** Inclusive upper bound on `dueAt`. */
	to: isoDateTime.optional(),
});

export type ListDeadlinesQuery = z.infer<typeof listDeadlinesQuery>;

/** Audit view: what was actually dispatched, for debugging a missed reminder. */
export const deadlineRemindersSchema = z.object({
	deadlineId: DeadlineIdSchema,
	title: z.string(),
	dueAt: isoDateTime,
	scheduled: z.array(z.object({ leadTimeHours: z.number().int().positive() })),
	sent: z.array(
		z.object({
			leadTimeHours: z.number().int().positive(),
			sentAt: isoDateTime,
		}),
	),
});

export type DeadlineReminders = z.infer<typeof deadlineRemindersSchema>;
