import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

/**
 * Reminder deadlines, kept separate from assessments on purpose.
 *
 * An exam on the 20th and the assignment due on the 15th are different
 * instants, and registration or withdrawal deadlines are not assessments at
 * all. This collection also owns `remindersSent`, so reminder delivery state has
 * exactly one home and a resend cannot happen by accident.
 */
const DeadlineSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		type: {
			type: String,
			enum: ["ASSESSMENT", "REGISTRATION", "WITHDRAWAL", "EXAM", "OTHER"],
			required: true,
		},
		courseId: { type: Schema.Types.ObjectId, ref: "Course", default: null },
		/** Set when the deadline was created from an assessment. */
		assessmentId: { type: Schema.Types.ObjectId, ref: "Assessment", default: null },
		/**
		 * What kind of assessment an `ASSESSMENT` deadline is for (a CT, a
		 * quiz…). The app's reminder lead time depends on it.
		 */
		assessmentType: {
			type: String,
			enum: ["CT", "ASSIGNMENT", "QUIZ", "MIDTERM", "FINAL", "LAB", "PROJECT", "OTHER", null],
			default: null,
		},
		title: { type: String, required: true },
		/** A UTC instant, unlike a routine slot's wall-clock times. */
		dueAt: { type: Date, required: true },
		/** Offsets before `dueAt` at which to remind, in hours. */
		reminderLeadTimes: { type: [Number], default: [72, 24] },
		remindersSent: {
			type: [
				new Schema(
					{ leadTimeHours: Number, sentAt: Date },
					{ _id: false },
				),
			],
			default: [],
		},
	},
	{ timestamps: true, collection: "deadlines", versionKey: false },
);

// Backs both the reminder job's "what is due soon" sweep and the
// home-screen reminders widget.
DeadlineSchema.index({ userId: 1, dueAt: 1 });
DeadlineSchema.index({ userId: 1, courseId: 1, dueAt: 1 });

export type DeadlineDocument = InferSchemaType<typeof DeadlineSchema> & { _id: unknown };

export const Deadline = defineModel("Deadline", DeadlineSchema);
