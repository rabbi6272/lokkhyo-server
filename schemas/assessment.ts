import { z } from "zod";

import {
	assessmentType,
	AssessmentIdSchema,
	CourseIdSchema,
	isoDateTime,
} from "@/schemas/common";

export const assessmentSchema = z.object({
	id: AssessmentIdSchema,
	courseId: CourseIdSchema,
	type: assessmentType,
	title: z.string(),
	/** When the assessment is sat. `YYYY-MM-DD`. */
	date: z.string(),
	maxMarks: z.number().positive(),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Assessment = z.infer<typeof assessmentSchema>;

export const createAssessmentInput = z.strictObject({
	courseId: CourseIdSchema,
	type: assessmentType,
	title: z.string().min(1).max(160),
	date: z.iso.date(),
	maxMarks: z.coerce.number().positive().max(10_000),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentInput>;

export const updateAssessmentInput = z
	.strictObject({
		type: assessmentType.optional(),
		title: z.string().min(1).max(160).optional(),
		date: z.iso.date().optional(),
		maxMarks: z.coerce.number().positive().max(10_000).optional(),
	})
	.partial();

export type UpdateAssessmentInput = z.infer<typeof updateAssessmentInput>;

export const assessmentIdParams = z.object({ id: AssessmentIdSchema });
export type AssessmentIdParams = z.infer<typeof assessmentIdParams>;

export const listAssessmentsQuery = z.object({
	courseId: CourseIdSchema.optional(),
	/** Only assessments dated on or after today. */
	upcoming: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default(false),
});

export type ListAssessmentsQuery = z.infer<typeof listAssessmentsQuery>;
