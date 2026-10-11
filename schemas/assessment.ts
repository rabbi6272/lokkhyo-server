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
	marksObtained: z.number().nonnegative().nullable().default(null),
	weight: z.number().nullable().default(null),
	teacherName: z.string().nullable().default(null),
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Assessment = z.infer<typeof assessmentSchema>;

const marksObtained = z.number().nonnegative().max(10_000).nullable();
const weight = z.number().min(0).max(100).nullable();
const teacherName = z.string().min(1).max(120).nullable();

export const createAssessmentInput = z
	.strictObject({
		courseId: CourseIdSchema,
		type: assessmentType,
		title: z.string().min(1).max(160),
		date: z.iso.date(),
		maxMarks: z.coerce.number().positive().max(10_000),
		marksObtained: marksObtained.optional(),
		weight: weight.optional(),
		teacherName: teacherName.optional(),
	})
	.refine(
		(data) => data.marksObtained == null || data.marksObtained <= data.maxMarks,
		{ message: "marksObtained cannot exceed maxMarks", path: ["marksObtained"] },
	);

export type CreateAssessmentInput = z.infer<typeof createAssessmentInput>;

export const updateAssessmentInput = z
	.strictObject({
		type: assessmentType.optional(),
		title: z.string().min(1).max(160).optional(),
		date: z.iso.date().optional(),
		maxMarks: z.coerce.number().positive().max(10_000).optional(),
		marksObtained: marksObtained.optional(),
		weight: weight.optional(),
		teacherName: teacherName.optional(),
	})
	.partial()
	.refine(
		(data) =>
			data.marksObtained == null ||
			data.maxMarks === undefined ||
			data.marksObtained <= data.maxMarks,
		{ message: "marksObtained cannot exceed maxMarks", path: ["marksObtained"] },
	);

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
