import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

const SemesterSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		name: { type: String, required: true },
		startDate: { type: String, required: true },
		endDate: { type: String, required: true },
		/**
		 * Which term the app treats as current. Exactly one is `ACTIVE` once the
		 * student has chosen; `POST /semesters/:id/activate` keeps it that way.
		 */
		status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE" },
		/** RUET scale, 0–4. Null means "no target set". */
		targetGpa: { type: Number, default: null },
		/**
		 * Teaching weeks. The app's attendance calendar is generated from
		 * `startDate` + `totalWeeks`; `endDate` is derived from it on write.
		 */
		totalWeeks: { type: Number, default: null },
	},
	{ timestamps: true, collection: "semesters", versionKey: false },
);

// Tenant scoping belongs in the index, not only in the query filter: every read
// is `userId`-prefixed, so this is the access path for all of them.
SemesterSchema.index({ userId: 1, createdAt: -1 });
SemesterSchema.index({ userId: 1, startDate: -1 });

export type SemesterDocument = InferSchemaType<typeof SemesterSchema> & { _id: unknown };

export const Semester = defineModel("Semester", SemesterSchema);
