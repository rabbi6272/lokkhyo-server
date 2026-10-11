import { Types } from "mongoose";
import type { z } from "zod";

import type { Page } from "@/lib/pagination";

/**
 * The boundary between the database shape and the API shape.
 *
 * A Mongo document carries `_id: ObjectId` and `createdAt: Date`. The API
 * contract — which is what the Flutter client codes against — carries `id` as a
 * string and timestamps as ISO-8601. Mixing the two throughout the service
 * layer means every function's return type has to be a hybrid, and the type
 * checker cannot tell a real mismatch from a cosmetic one.
 *
 * So services deal only in Mongo shapes, and every response passes through
 * `serialize` on the way out. This is also the only place where a document is
 * allowed to become a response, which makes the Zod response schemas meaningful
 * as a check rather than decoration: a field renamed in a model breaks the
 * build here instead of silently disappearing from the client's response.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Convert a Mongoose document to the plain JSON shape the contract describes.
 *
 * ObjectIds become strings and Dates become ISO-8601, recursively, so a nested
 * populated field is converted on the same pass as a top-level one. `__v` is
 * dropped: it is a storage detail, and exposing it would invite a client to
 * depend on it.
 */
export function serialize(value: unknown): Json {
	if (value === null || value === undefined) {
		return null;
	}

	if (value instanceof Types.ObjectId) {
		return value.toHexString();
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	if (Array.isArray(value)) {
		return value.map(serialize);
	}

	// A lean document is a plain object; a hydrated Mongoose document is not,
	// so both shapes are handled by the same branch.
	if (typeof value === "object") {
		const source =
			typeof (value as { toObject?: () => Record<string, unknown> }).toObject ===
			"function"
				? (value as { toObject: () => Record<string, unknown> }).toObject()
				: (value as Record<string, unknown>);

		const out: Record<string, Json> = {};
		for (const [key, item] of Object.entries(source)) {
			if (key === "__v") {
				continue;
			}
			out[key === "_id" ? "id" : key] = serialize(item);
		}
		return out;
	}

	if (typeof value === "bigint") {
		return Number(value);
	}

	return value as Json;
}

/**
 * Serialize, then assert the result against the response schema.
 *
 * The parse is not defensive decoration. A model field that is renamed, dropped,
 * or given the wrong type fails here — in the route that produced it — instead
 * of reaching a client that has already been written against the old shape.
 * Throwing is the point: a contract violation is a bug, not a warning.
 */
export function respond<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
	return schema.parse(serialize(data)) as z.infer<S>;
}

/**
 * Cursor-paginated envelope.
 *
 * `buildPage` works in Mongo shapes because it sorts on `createdAt`/`_id`; this
 * is where the finished page becomes a validated response.
 */
export function respondPage<P extends z.ZodType, T extends { createdAt: Date }>(
	schema: P,
	page: Page<T>,
): z.infer<P> {
	return respond(schema, {
		data: page.data,
		pagination: page.pagination,
	}) as z.infer<P>;
}
