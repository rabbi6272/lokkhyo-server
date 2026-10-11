import { Schema, model, type InferSchemaType } from "mongoose";

const CourseSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		semesterId: { type: Schema.Types.ObjectId, ref: "Semester", required: true },
		title: { type: String, required: true },
		code: { type: String, required: true },
		instructor: { type: String, default: null },
		/**
		 * The single source of truth for this course's credit value. Results
		 * copy it at write time so editing it here cannot restate a past
		 * semester's transcript.
		 */
		credits: { type: Number, required: true, default: 3 },
	},
	{ timestamps: true, collection: "courses", versionKey: false },
);

CourseSchema.index({ userId: 1, semesterId: 1, createdAt: -1 });
CourseSchema.index({ userId: 1, code: 1 });

export type CourseDocument = InferSchemaType<typeof CourseSchema> & { _id: unknown };

export const Course = model("Course", CourseSchema);

/**
 * A weekly recurring class slot. Stored as a day plus wall-clock strings rather
 * than a datetime, because 09:00 means 09:00 in the owner's own timezone.
 */
const RoutineSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
		dayOfWeek: {
			type: String,
			enum: ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
			required: true,
		},
		startTime: { type: String, required: true },
		endTime: { type: String, required: true },
		room: { type: String, default: null },
	},
	{ timestamps: true, collection: "routines", versionKey: false },
);

RoutineSchema.index({ userId: 1, courseId: 1 });
// The morning digest looks up "today's classes" by day; this is that access path.
RoutineSchema.index({ userId: 1, dayOfWeek: 1, startTime: 1 });

export type RoutineDocument = InferSchemaType<typeof RoutineSchema> & { _id: unknown };

export const Routine = model("Routine", RoutineSchema);
