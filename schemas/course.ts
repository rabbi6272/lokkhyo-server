import { z } from "zod";

import {
	credits,
	CourseIdSchema,
	isoDateTime,
	RoutineIdSchema,
	SemesterIdSchema,
	OwnerUidSchema,
	wallClockTime,
	dayOfWeek,
} from "@/schemas/common";

export const courseSchema = z.object({
	id: CourseIdSchema,
	userId: OwnerUidSchema,
	semesterId: SemesterIdSchema,
	title: z.string(),
	code: z.string(),
	instructor: z.string().nullable(),
	/**
	 * Single source of truth for the credit value. Results snapshot their own
	 * copy at write time so a later edit here cannot rewrite history.
	 */
	credits: z.number(),
	// Defaults keep documents written before these fields existed parseable.
	passMarks: z.number().nullable().default(null),
	ctWeight: z.number().nullable().default(null),
	isLab: z.boolean().default(false),
	courseTeachers: z.array(z.string()).default([]),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Course = z.infer<typeof courseSchema>;

export const createCourseInput = z.strictObject({
	semesterId: SemesterIdSchema,
	title: z.string().min(1).max(160),
	code: z.string().min(1).max(32),
	instructor: z.string().min(1).max(120).optional(),
	credits: credits.default(3),
	passMarks: z.number().min(0).max(100).nullable().optional(),
	ctWeight: z.number().min(0).max(100).nullable().optional(),
	isLab: z.boolean().optional(),
	courseTeachers: z.array(z.string().min(1).max(120)).max(10).optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseInput>;

export const updateCourseInput = z
	.strictObject({
		title: z.string().min(1).max(160).optional(),
		code: z.string().min(1).max(32).optional(),
		instructor: z.string().min(1).max(120).nullable().optional(),
		credits: credits.optional(),
		semesterId: SemesterIdSchema.optional(),
		passMarks: z.number().min(0).max(100).nullable().optional(),
		ctWeight: z.number().min(0).max(100).nullable().optional(),
		isLab: z.boolean().optional(),
		courseTeachers: z.array(z.string().min(1).max(120)).max(10).optional(),
	})
	.partial();

export type UpdateCourseInput = z.infer<typeof updateCourseInput>;

export const courseIdParams = z.object({ id: CourseIdSchema });
export type CourseIdParams = z.infer<typeof courseIdParams>;

export const listCoursesQuery = z.object({
	semesterId: SemesterIdSchema.optional(),
});

export type ListCoursesQuery = z.infer<typeof listCoursesQuery>;

/**
 * One weekly recurring slot.
 *
 * `dayOfWeek` plus a wall-clock `HH:mm` pair, not a datetime: 09:00 on Monday
 * means 09:00 in the owner's timezone on whichever Monday falls, and a UTC
 * instant would drift by the offset.
 */
export const routineSlotSchema = z
	.object({
		dayOfWeek,
		startTime: wallClockTime,
		endTime: wallClockTime,
		room: z.string().max(80).nullable().default(null),
	})
	.refine((slot) => slot.endTime > slot.startTime, {
		message: "endTime must be after startTime",
		path: ["endTime"],
	});

export type RoutineSlot = z.infer<typeof routineSlotSchema>;

export const routineEntrySchema = routineSlotSchema.extend({
	id: RoutineIdSchema,
	courseId: CourseIdSchema,
});

export type RoutineEntry = z.infer<typeof routineEntrySchema>;

/** The course's complete weekly slot set, as returned. */
export const routineSchema = z.array(routineEntrySchema);

/**
 * `PUT` replaces the course's whole weekly slot set. A timetable is a bounded
 * document rather than a partial edit, so replace-semantics is both simpler and
 * naturally idempotent — no `Idempotency-Key` needed.
 */
export const replaceRoutineInput = z.strictObject({
	slots: z
		.array(
			z
				.strictObject({
					/**
					 * An existing slot's id keeps that slot (and the attendance
					 * filed under it); a slot without one is created. Slots of the
					 * course left out of the set are deleted.
					 */
					id: RoutineIdSchema.optional(),
					dayOfWeek,
					startTime: wallClockTime,
					endTime: wallClockTime,
					room: z.string().max(80).nullable().default(null),
				})
				.refine((slot) => slot.endTime > slot.startTime, {
					message: "endTime must be after startTime",
					path: ["endTime"],
				}),
		)
		.max(20),
});

export type ReplaceRoutineInput = z.infer<typeof replaceRoutineInput>;

export const courseRoutineParams = z.object({ id: CourseIdSchema });
export type CourseRoutineParams = z.infer<typeof courseRoutineParams>;

export const routineQuery = z.object({
	/** `YYYY-MM-DD`; defaults to today in the caller's timezone. */
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date")
		.optional(),
});

export type RoutineQuery = z.infer<typeof routineQuery>;

/** A routine slot resolved onto a specific calendar date. */
export const scheduledClassSchema = routineEntrySchema.extend({
	course: z.object({
		id: CourseIdSchema,
		title: z.string(),
		code: z.string(),
	}),
});

export type ScheduledClass = z.infer<typeof scheduledClassSchema>;
