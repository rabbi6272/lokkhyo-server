import { createHash } from "node:crypto";

import { Schema, model } from "mongoose";

import { AppError, ErrorCode } from "@/lib/errors";
import { connect } from "@/lib/db";

/**
 * How long a key is remembered. This must outlive the longest path that can
 * re-deliver the same intent. The client queues writes while offline and
 * retries on reconnect, so the window is the offline retry budget, not how long
 * it takes to process a request.
 */
export const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const IdempotencyKeySchema = new Schema(
	{
		userId: { type: String, required: true },
		key: { type: String, required: true },
		/** Hash of the canonical request body; detects key reuse with new intent. */
		requestHash: { type: String, required: true },
		state: {
			type: String,
			enum: ["in_progress", "succeeded"],
			required: true,
		},
		status: Number,
		body: Schema.Types.Mixed,
		expiresAt: { type: Date, required: true },
	},
	{ collection: "idempotencyKeys", versionKey: false },
);

// The unique index *is* the mutual-exclusion mechanism. A read-then-write claim
// would let two concurrent retries both observe "not seen" and both apply the
// effect; a failed insert tells us unambiguously that we lost the race.
IdempotencyKeySchema.index({ userId: 1, key: 1 }, { unique: true });
// Mongo evicts expired claims for us, so the collection cannot grow unbounded.
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const IdempotencyKey = model("IdempotencyKey", IdempotencyKeySchema);

const DUPLICATE_KEY = 11000;

/**
 * Deterministic JSON: object keys sorted, so that a client re-serialising the
 * same logical payload in a different key order still produces one hash. The
 * idempotency check must not punish a client for being differently tidy.
 */
export function canonicalise(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalise).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries
		.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`)
		.join(",")}}`;
}

export function hashPayload(payload: unknown): string {
	return createHash("sha256").update(canonicalise(payload)).digest("hex");
}

export type Claim =
	| { kind: "claimed" }
	| { kind: "replay"; status: number; body: unknown }
	| { kind: "in_flight" };

/**
 * Attempt to take exclusive ownership of `key` for this user.
 *
 * Throws 422 if the same key arrives with a different body — that is a client
 * bug, and silently replaying the first response would apply the wrong intent.
 * Throws 409 if an identical request is still running, rather than letting a
 * second caller through because the first looks slow.
 */
export async function claim(
	userId: string,
	key: string,
	requestHash: string,
): Promise<Claim> {
	await connect();

	try {
		await IdempotencyKey.create({
			userId,
			key,
			requestHash,
			state: "in_progress",
			expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_SECONDS * 1000),
		});
		return { kind: "claimed" };
	} catch (error) {
		if (!isDuplicateKey(error)) {
			throw error;
		}
	}

	// Losing the race is the expected path under a retry storm, not an error.
	const existing = await IdempotencyKey.findOne({ userId, key }).lean();
	if (!existing) {
		// The winner's claim expired or was released between our insert and
		// this read. Treat it as a fresh claim.
		return claim(userId, key, requestHash);
	}

	if (existing.requestHash !== requestHash) {
		throw new AppError(
			ErrorCode.IDEMPOTENCY_KEY_REUSED,
			"This Idempotency-Key was already used with a different request body",
		);
	}

	if (existing.state === "in_progress") {
		return { kind: "in_flight" };
	}

	return {
		kind: "replay",
		status: existing.status ?? 200,
		body: existing.body,
	};
}

export async function complete(
	userId: string,
	key: string,
	status: number,
	body: unknown,
): Promise<void> {
	await connect();
	await IdempotencyKey.updateOne(
		{ userId, key },
		{ $set: { state: "succeeded", status, body } },
	);
}

/**
 * Drop the claim after an unexpected failure. A key left `in_progress` would
 * make every subsequent retry fail 409 until the TTL expired, turning one
 * transient error into a week of blocked writes.
 */
export async function release(userId: string, key: string): Promise<void> {
	await connect();
	await IdempotencyKey.deleteOne({ userId, key, state: "in_progress" });
}

function isDuplicateKey(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === DUPLICATE_KEY
	);
}

export function requireIdempotencyKey(request: Request): string {
	const key = request.headers.get("idempotency-key")?.trim();
	if (!key) {
		throw new AppError(
			ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
			"This endpoint requires an Idempotency-Key header. Generate one per intent and reuse it across retries.",
		);
	}
	return key;
}

/**
 * Wrap a state-changing handler in the claim/replay protocol.
 *
 * The key must come from the client and describe the *intent*, not the attempt
 * — a fresh UUID per try defeats the entire mechanism, and a timestamp is the
 * same mistake wearing a hat.
 */
export async function withIdempotency(
	request: Request,
	userId: string,
	payload: unknown,
	handler: () => Promise<Response>,
): Promise<Response> {
	const key = requireIdempotencyKey(request);
	const outcome = await claim(userId, key, hashPayload(payload));

	if (outcome.kind === "replay") {
		return Response.json(outcome.body, { status: outcome.status });
	}
	if (outcome.kind === "in_flight") {
		throw new AppError(
			ErrorCode.CONFLICT,
			"An identical request with this Idempotency-Key is still in progress",
		);
	}

	try {
		const response = await handler();
		const body = await response.clone().json().catch(() => null);
		// Only successful effects are recorded. A 4xx or 5xx is the client's to
		// fix and retry, so it must not burn the key.
		if (response.status < 400) {
			await complete(userId, key, response.status, body);
		} else {
			await release(userId, key);
		}
		return response;
	} catch (error) {
		await release(userId, key);
		throw error;
	}
}
