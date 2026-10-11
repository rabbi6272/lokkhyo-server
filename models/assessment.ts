import { Schema, model, type InferSchemaType } from "mongoose";

const AssessmentSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
		type: {
			type: String,
			enum: ["ASSIGNMENT", "QUIZ", "MIDTERM", "FINAL", "LAB", "PROJECT", "OTHER"],
			required: true,
		},
		title: { type: String, required: true },
		/** `YYYY-MM-DD`. */
		date: { type: String, required: true },
		maxMarks: { type: Number, required: true },
	},
	{ timestamps: true, collection: "assessments", versionKey: false },
);

AssessmentSchema.index({ userId: 1, courseId: 1, date: 1 });
// Backs the "upcoming assessments" list and the home-screen reminders widget.
AssessmentSchema.index({ userId: 1, date: 1 });

export type AssessmentDocument = InferSchemaType<typeof AssessmentSchema> & { _id: unknown };

export const Assessment = model("Assessment", AssessmentSchema);
