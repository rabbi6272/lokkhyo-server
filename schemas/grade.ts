import { z } from "zod";

import {
	classification,
	CourseIdSchema,
	isoDateTime,
	letterGrade,
	resultStatus,
} from "@/schemas/common";

/**
 * The grading scale, as served.
 *
 * This is a mirror of `lib/grading.ts` in schema form. It lives in `schemas/`
 * rather than inline in the route so that the shape the client codes against
 * is reviewable alongside every other response contract, and so a change to the
 * engine's DTO fails the build here instead of drifting quietly.
 */
export const gradingScaleSchema = z.object({
	/** One band per letter grade, `I` last, ordered by descending percentage. */
	scale: z.array(
		z.object({
			letterGrade,
			/** `null` only for `I`, which is asserted rather than earned. */
			minPercentage: z.number().nullable(),
			gradePoint: z.number().nullable(),
			countsTowardGPA: z.boolean(),
			countsAsEarnedCredit: z.boolean(),
		}),
	),
	degreeCgpaThreshold: z.number(),
	/** The CGPA bands the degree classification is read off. */
	classificationBoundaries: z.array(
		z.object({
			classification,
			/** `null` for the terminal band, which has no floor. */
			minCgpa: z.number().nullable(),
		}),
	),
});

export type GradingScale = z.infer<typeof gradingScaleSchema>;

/** `GET /me/gpa?semesterId=` — a single semester's stored aggregate. */
export const semesterGpaSchema = z.object({
	semesterId: z.string(),
	gpa: z.number().nullable(),
});

export type SemesterGpa = z.infer<typeof semesterGpaSchema>;

/**
 * `GET /me/cgpa` — the stored cumulative aggregate.
 *
 * `totalCredits` is the counted (GPA-bearing) credit sum, not credits earned;
 * classification and earned credits belong to `/me/degree-status`.
 *
 * `totalWeightedPoints` is the unrounded numerator behind `cgpa`. It is served
 * because `cgpa` alone is rounded to 2dp, and a client projecting a future
 * CGPA would otherwise have to rebuild the numerator as `cgpa * totalCredits`
 * — reintroducing the rounding error that computing-on-write exists to avoid.
 */
export const cgpaSchema = z.object({
	cgpa: z.number().nullable(),
	totalCredits: z.number().nonnegative(),
	totalWeightedPoints: z.number().nonnegative(),
	coursesCounted: z.number().int().nonnegative(),
});

export type Cgpa = z.infer<typeof cgpaSchema>;

/**
 * A result as returned, with the grade-improvement flag attached.
 *
 * The flag is derived on read rather than stored, so it can never disagree with
 * the CGPA it is derived from.
 */
export const resultWithFlagSchema = z.object({
	id: z.string(),
	courseId: z.string(),
	assessmentId: z.string(),
	semesterId: z.string(),
	attempt: z.number().int().positive(),
	isLatestAttempt: z.boolean(),
	credits: z.number(),
	marksObtained: z.number(),
	maxMarks: z.number(),
	percentage: z.number(),
	letterGrade: letterGrade,
	gradePoint: z.number().nullable(),
	status: resultStatus,
	countsTowardGPA: z.boolean(),
	countsAsEarnedCredit: z.boolean(),
	isGradeImprovementEligible: z.boolean(),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type ResultWithFlag = z.infer<typeof resultWithFlagSchema>;

/**
 * `POST`/`PUT` on a result also report the recomputed aggregates.
 *
 * Returning them in the same response saves the client a second round trip on
 * the exact operation where a stale GPA would be most confusing — the student
 * sees the new grade and the new CGPA together.
 */
export const resultWriteResponseSchema = z.object({
	result: resultWithFlagSchema,
	semesterGpa: z.number().nullable(),
	cgpa: z.number().nullable(),
});

export type ResultWriteResponse = z.infer<typeof resultWriteResponseSchema>;

export const improvementCandidateSchema = z.object({
	courseId: CourseIdSchema,
	courseCode: z.string(),
});
