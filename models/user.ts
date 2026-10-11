import { Schema, model, type InferSchemaType } from "mongoose";

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
		lastLoginAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: "users", versionKey: false },
);

UserSchema.index({ firebaseUid: 1 }, { unique: true });

export type UserDocument = InferSchemaType<typeof UserSchema> & { _id: unknown };

export const User = model("User", UserSchema);
