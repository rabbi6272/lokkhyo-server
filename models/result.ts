import { Schema, model, type InferSchemaType } from "mongoose";

const ResultSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		assessmentId: { type: Schema.Types.ObjectId, ref: "Assessment", required: true },
		courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
		semesterId: { type: Schema.Types.ObjectId, ref: "Semester", required: true },

		/** 1 for the first sitting, incremented for each repeat. */
		attempt: { type: Number, required: true, default: 1 },
		/**
		 * The single attempt that feeds the GPA. At most one may be true per
		 * course — enforced below, not merely by convention in application code.
		 */
		isLatestAttempt: { type: Boolean, required: true, default: true },

		// Snapshots, taken at write time. The transcript is immutable history:
		// these must not be re-read from the course or assessment later.
		credits: { type: Number, required: true },
		marksObtained: { type: Number, required: true },
		maxMarks: { type: Number, required: true },
		percentage: { type: Number, required: true },

		letterGrade: { type: String, required: true },
		/** `null` for `I` only. */
		gradePoint: { type: Number, default: null },
		status: {
			type: String,
			enum: ["PASSED", "BACKLOG", "INCOMPLETE"],
			required: true,
		},
		countsTowardGPA: { type: Boolean, required: true },
		countsAsEarnedCredit: { type: Boolean, required: true },
	},
	{ timestamps: true, collection: "results", versionKey: false },
);

/**
 * The retake invariant, enforced by the database.
 *
 * A repeat supersedes rather than overwrites: the earlier attempt stays on the
 * record, and only the attempt flagged here feeds the GPA. Making this a
 * partial unique index means a race between two concurrent submissions cannot
 * leave two "latest" attempts, which would double-count the credits.
 */
ResultSchema.index(
	{ userId: 1, courseId: 1, isLatestAttempt: 1 },
	{
		unique: true,
		partialFilterExpression: { isLatestAttempt: true },
	},
);
ResultSchema.index({ userId: 1, semesterId: 1, isLatestAttempt: 1 });
ResultSchema.index({ userId: 1, courseId: 1, attempt: -1 });

export type ResultDocument = InferSchemaType<typeof ResultSchema> & { _id: unknown };

export const Result = model("Result", ResultSchema);

const GpaRecordSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		/** `null` for the cumulative record. */
		semesterId: { type: Schema.Types.ObjectId, ref: "Semester", default: null },
		gpa: { type: Number, default: null },
		/**
		 * Unrounded on purpose. Only the reported `gpa` is rounded to 2dp;
		 * rounding the stored sums would make a later cumulative recomputation
		 * drift away from one computed directly.
		 */
		totalCredits: { type: Number, required: true, default: 0 },
		totalWeightedPoints: { type: Number, required: true, default: 0 },
		coursesCounted: { type: Number, required: true, default: 0 },
	},
	{ timestamps: true, collection: "gpaRecords", versionKey: false },
);

// One semester record per student, plus at most one cumulative record
// (semesterId: null).
GpaRecordSchema.index({ userId: 1, semesterId: 1 }, { unique: true });

export type GpaRecordDocument = InferSchemaType<typeof GpaRecordSchema> & { _id: unknown };

export const GpaRecord = model("GpaRecord", GpaRecordSchema);
