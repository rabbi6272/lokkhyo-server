import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

const AssessmentSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
		type: {
			type: String,
			enum: ["CT", "ASSIGNMENT", "QUIZ", "MIDTERM", "FINAL", "LAB", "PROJECT", "OTHER"],
			required: true,
		},
		title: { type: String, required: true },
		/** `YYYY-MM-DD`. */
		date: { type: String, required: true },
		maxMarks: { type: Number, required: true },
		/**
		 * The component mark (a CT, a quiz) as the student recorded it. This is
		 * coursework, not a graded course attempt: those go to `results`, whose
		 * one-counted-attempt-per-course index could not hold several CTs.
		 */
		marksObtained: { type: Number, default: null },
		/** Share of the course total, in percent. */
		weight: { type: Number, default: null },
		teacherName: { type: String, default: null },
	},
	{ timestamps: true, collection: "assessments", versionKey: false },
);

AssessmentSchema.index({ userId: 1, courseId: 1, date: 1 });
// Backs the "upcoming assessments" list and the home-screen reminders widget.
AssessmentSchema.index({ userId: 1, date: 1 });

export type AssessmentDocument = InferSchemaType<typeof AssessmentSchema> & { _id: unknown };

export const Assessment = defineModel("Assessment", AssessmentSchema);
