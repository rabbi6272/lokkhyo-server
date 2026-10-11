import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

const AttendanceSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
		/** `YYYY-MM-DD`. A calendar date, not an instant. */
		date: { type: String, required: true },
		/**
		 * The routine slot this session belongs to, so two classes of one course
		 * on the same day are marked separately. Null for a course-day record
		 * that is not tied to a slot.
		 */
		slotId: { type: String, default: null },
		status: {
			type: String,
			enum: ["PRESENT", "ABSENT", "LATE", "EXCUSED", "CANCELLED"],
			required: true,
		},
		note: { type: String, default: null },
	},
	{ timestamps: true, collection: "attendance", versionKey: false },
);

/**
 * One record per session: course, day, and slot.
 *
 * The unique index is the second line of defence for `PUT`: even a retried
 * write cannot double-count a session in the percentage. `slotId: null` is a
 * value like any other here, so slot-less course-day records stay unique too.
 *
 * This replaced a `(userId, courseId, date)` index. Mongoose only *adds*
 * indexes on connect, so `ensureAttendanceIndexes()` drops the old one.
 */
AttendanceSchema.index(
	{ userId: 1, courseId: 1, date: 1, slotId: 1 },
	{ unique: true, name: "userId_1_courseId_1_date_1_slotId_1" },
);
AttendanceSchema.index({ userId: 1, date: -1 });

export type AttendanceDocument = InferSchemaType<typeof AttendanceSchema> & { _id: unknown };

export const Attendance = defineModel("Attendance", AttendanceSchema);
