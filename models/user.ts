import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

/**
 * Field definitions only. Validation of *incoming* data belongs to the Zod
 * schemas in `schemas/`, at the route boundary — declaring rules in two places
 * is how the two drift apart.
 */
const UserSchema = new Schema(
	{
		/** Firebase's stable identifier. The Mongo `_id` is an implementation detail. */
		firebaseUid: { type: String, required: true },
		email: { type: String, default: null },
		/** Owned by the student; the provider value only seeds the first write. */
		name: { type: String, default: null },
		photoUrl: { type: String, default: null },
		role: { type: String, enum: ["STUDENT", "INSTRUCTOR", "ADMIN"], default: "STUDENT" },
		/** IANA zone. Every scheduled reminder is resolved against this. */
		timezone: { type: String, default: "Asia/Dhaka" },
		/**
		 * Academic context the app needs and the server did not model before.
		 * All four are owned by the student and written through `PATCH /me`; the
		 * seed is empty, so a new account starts with nothing filled in.
		 */
		university: { type: String, default: null },
		department: { type: String, default: null },
		/** The student's active `semesters` id, or null when none is chosen. */
		currentSemesterId: { type: String, default: null },
		/** RUET scale, 0–4. Null means "no target set yet". */
		targetCgpa: { type: Number, default: null },
		lastLoginAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: "users", versionKey: false },
);

UserSchema.index({ firebaseUid: 1 }, { unique: true });

export type UserDocument = InferSchemaType<typeof UserSchema> & { _id: unknown };

export const User = defineModel("User", UserSchema);
