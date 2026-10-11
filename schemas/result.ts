import { z } from "zod";

import {
	AssessmentIdSchema,
	classification,
	CourseIdSchema,
	isoDateTime,
	letterGrade,
	ResultIdSchema,
	resultStatus,
	SemesterIdSchema,
} from "@/schemas/common";

/**
 * A course result — the unit the GPA is computed from.
 *
 * `credits`, `letterGrade` and `gradePoint` are *snapshots* taken at write
 * time, not joins back to the course. The transcript is an immutable historical
 * record: editing a course's credits later must not silently restate a past
 * semester, and a regrade must not mutate the attempt it replaces.
 */
export const resultSchema = z.object({
	id: ResultIdSchema,
	assessmentId: AssessmentIdSchema,
	courseId: CourseIdSchema,
	semesterId: SemesterIdSchema,
	/** 1 for the first sitting, incremented for each repeat. */
	attempt: z.number().int().positive(),
	/** True for the one attempt that feeds the GPA. Enforced by a partial unique index. */
	isLatestAttempt: z.boolean(),
	credits: z.number(),
	marksObtained: z.number().nonnegative(),
	maxMarks: z.number().positive(),
	percentage: z.number().min(0).max(100),
	letterGrade: letterGrade,
	gradePoint: z.number().nullable(),
	status: resultStatus,
	countsTowardGPA: z.boolean(),
	countsAsEarnedCredit: z.boolean(),
	/**
	 * A `D` while CGPA is below 2.20 may be improved by a repeat. Advisory and
	 * recomputed on read, because CGPA moves after this result was written.
	 */
	isGradeImprovementEligible: z.boolean().default(false),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Result = z.infer<typeof resultSchema>;

/**
 * Creating a result.
 *
 * `incomplete` asserts `I` without marks; the engine short-circuits on it, so
 * an incomplete result can never be derived from a low score. Omitting
 * `marksObtained` and setting `incomplete` is the only way to record one.
 */
export const createResultInput = z
	.strictObject({
		assessmentId: AssessmentIdSchema,
		marksObtained: z.coerce.number().nonnegative().optional(),
		incomplete: z.boolean().default(false),
	})
	.refine((data) => data.incomplete || data.marksObtained !== undefined, {
		message: "marksObtained is required unless incomplete is true",
		path: ["marksObtained"],
	});

export type CreateResultInput = z.infer<typeof createResultInput>;

/** `PUT` with the full desired state, so retries are safe without a key. */
export const updateResultInput = z
	.strictObject({
		marksObtained: z.coerce.number().nonnegative().optional(),
		incomplete: z.boolean().default(false),
	})
	.refine((data) => data.incomplete || data.marksObtained !== undefined, {
		message: "marksObtained is required unless incomplete is true",
		path: ["marksObtained"],
	});

export type UpdateResultInput = z.infer<typeof updateResultInput>;

export const resultIdParams = z.object({ id: ResultIdSchema });
export type ResultIdParams = z.infer<typeof resultIdParams>;

export const listResultsQuery = z.object({
	courseId: CourseIdSchema.optional(),
	semesterId: SemesterIdSchema.optional(),
	/** Include superseded attempts in addition to the latest. */
	includeSuperseded: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default(false),
});

export type ListResultsQuery = z.infer<typeof listResultsQuery>;

/** What `POST /results` returns: the result plus the recomputed figures. */
export const resultWithGpaSchema = z.object({
	result: resultSchema,
	semesterGpa: z.number().nullable(),
	cgpa: z.number().nullable(),
});

export type ResultWithGpa = z.infer<typeof resultWithGpaSchema>;

export const gpaQuery = z.object({
	semesterId: SemesterIdSchema.optional(),
});

export type GpaQuery = z.infer<typeof gpaQuery>;

/**
 * Stored aggregate. `totalCredits` and `totalWeightedPoints` are kept unrounded
 * so that a CGPA recomputed from them later is identical to one computed
 * directly; only the reported `gpa` is rounded.
 */
export const gpaRecordSchema = z.object({
	semesterId: SemesterIdSchema.nullable(),
	gpa: z.number().nullable(),
	totalCredits: z.number().nonnegative(),
	totalWeightedPoints: z.number().nonnegative(),
	coursesCounted: z.number().int().nonnegative(),
	updatedAt: isoDateTime,
});

export type GpaRecord = z.infer<typeof gpaRecordSchema>;

export const degreeStatusSchema = z.object({
	cgpa: z.number().nullable(),
	degreeCgpaThreshold: z.number(),
	classification: classification,
	isDegreeEligible: z.boolean(),
	totalCreditsEarned: z.number().nonnegative(),
	totalCreditsAttempted: z.number().nonnegative(),
	backlogCount: z.number().int().nonnegative(),
	incompleteCount: z.number().int().nonnegative(),
	improvementCandidates: z.array(
		z.object({ courseId: CourseIdSchema, courseCode: z.string() }),
	),
});

export type DegreeStatus = z.infer<typeof degreeStatusSchema>;

/**
 * One line of the transcript: the course joined to its latest counted attempt,
 * plus any superseded attempts retained for history.
 */
export const transcriptEntrySchema = z.object({
	courseId: CourseIdSchema,
	courseCode: z.string(),
	courseTitle: z.string(),
	semesterId: SemesterIdSchema,
	credits: z.number(),
	letterGrade: letterGrade,
	gradePoint: z.number().nullable(),
	status: resultStatus,
	countsAsEarnedCredit: z.boolean(),
	attempts: z.array(
		z.object({
			resultId: ResultIdSchema,
			attempt: z.number().int().positive(),
			marksObtained: z.number().nonnegative(),
			maxMarks: z.number().positive(),
			letterGrade: letterGrade,
			status: resultStatus,
			recordedAt: isoDateTime,
		}),
	),
});

export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const transcriptSchema = z.object({
	entries: z.array(transcriptEntrySchema),
	cgpa: z.number().nullable(),
});

export type Transcript = z.infer<typeof transcriptSchema>;
