import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

/**
 * One row per server-sent notification that has been claimed for delivery.
 *
 * The dispatch job runs every few minutes and may overlap with itself or be
 * retried. Inserting a claim is the mutual exclusion: the unique index lets
 * exactly one run win a given `(userId, key)`, e.g.
 * `attendance-digest:2026-10-11`, so a student never gets the same push twice.
 */
const PushClaimSchema = new Schema(
	{
		userId: { type: String, required: true },
		key: { type: String, required: true },
		createdAt: { type: Date, default: Date.now },
	},
	{ collection: "pushClaims", versionKey: false },
);

PushClaimSchema.index({ userId: 1, key: 1 }, { unique: true });
// Keys are day- or week-scoped, so a claim is useless after a few weeks.
PushClaimSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export type PushClaimDocument = InferSchemaType<typeof PushClaimSchema> & { _id: unknown };

export const PushClaim = defineModel("PushClaim", PushClaimSchema);
