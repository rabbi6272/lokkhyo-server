import { Schema, model, type InferSchemaType } from "mongoose";

const SemesterSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		name: { type: String, required: true },
		startDate: { type: String, required: true },
		endDate: { type: String, required: true },
	},
	{ timestamps: true, collection: "semesters", versionKey: false },
);

// Tenant scoping belongs in the index, not only in the query filter: every read
// is `userId`-prefixed, so this is the access path for all of them.
SemesterSchema.index({ userId: 1, createdAt: -1 });
SemesterSchema.index({ userId: 1, startDate: -1 });

export type SemesterDocument = InferSchemaType<typeof SemesterSchema> & { _id: unknown };

export const Semester = model("Semester", SemesterSchema);
