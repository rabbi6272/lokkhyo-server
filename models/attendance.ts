import { Schema, model, type InferSchemaType } from "mongoose";

const AttendanceSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
		/** `YYYY-MM-DD`. A calendar date, not an instant. */
		date: { type: String, required: true },
		status: {
			type: String,
			enum: ["PRESENT", "ABSENT", "LATE", "EXCUSED"],
			required: true,
		},
		note: { type: String, default: null },
	},
	{ timestamps: true, collection: "attendance", versionKey: false },
);

/**
 * One record per course per session day.
 *
 * This is the second line of defence for `POST /attendance`: even if a client
 * retries without an idempotency key, the unique index refuses the duplicate
 * rather than double-counting a session in the percentage.
 */
AttendanceSchema.index({ userId: 1, courseId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ userId: 1, date: -1 });

export type AttendanceDocument = InferSchemaType<typeof AttendanceSchema> & { _id: unknown };

export const Attendance = model("Attendance", AttendanceSchema);
