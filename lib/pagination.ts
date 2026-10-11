import { Types } from "mongoose";
import { z } from "zod";

import { parseQuery } from "@/lib/http";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Cursors rather than page numbers, deliberately.
 *
 * This client is offline-first with a sync queue. Under `?page=2`, a record
 * inserted between the client fetching page 1 and page 2 shifts every later
 * record by one position, so the client silently skips one row and duplicates
 * another — and it has no way to detect that. A cursor is anchored to a sort
 * key, so concurrent inserts never move the client's window.
 */
export const limitQuery = z.object({
	limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
	cursor: z.string().min(1).optional(),
});

export type LimitQuery = z.infer<typeof limitQuery>;

export interface Cursor {
	/** ISO timestamp of the last item on the previous page. */
	at: string;
	/** Tie-breaker `_id` of that item, for identical timestamps. */
	id: string;
}

export function encodeCursor(cursor: Cursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(raw, "base64url").toString("utf8"),
		);
		const result = z
			.object({ at: z.string().min(1), id: z.string().min(1) })
			.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

export interface Page<T> {
	data: T[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}

export interface PageRequest {
	limit: number;
	cursor: Cursor | null;
}

/**
 * Reads `limit`/`cursor` off a URL and decodes the cursor. A structurally
 * invalid cursor is treated as "start from the beginning" rather than an error:
 * the client can recover on its own, and a hard failure here would only ever
 * strand a user who had already synced successfully.
 */
export function pageRequestFromUrl(url: URL): PageRequest {
	const { limit, cursor } = parseQuery(limitQuery, {
		limit: url.searchParams.get("limit") ?? undefined,
		cursor: url.searchParams.get("cursor") ?? undefined,
	});
	return { limit, cursor: cursor ? decodeCursor(cursor) : null };
}

/**
 * The key a list is ordered by.
 *
 * A cursor is only meaningful against the sort that produced it: anchoring a
 * `date`-sorted list on `createdAt` makes the next page start at an unrelated
 * position, skipping or repeating rows. So every list passes the same key to
 * `.sort()`, `keysetFilter` and `buildPage`, and the three cannot drift.
 *
 * `kind` says how the stored value is compared: a `Date` instant, or a string
 * such as a `YYYY-MM-DD` calendar date, which sorts correctly as text.
 */
export interface SortKey {
	field: string;
	direction: 1 | -1;
	kind: "date" | "string";
}

export const CREATED_DESC: SortKey = {
	field: "createdAt",
	direction: -1,
	kind: "date",
};

/** The Mongo `.sort()` spec for a key, with `_id` as the tie-breaker. */
export function sortSpec(sort: SortKey): Record<string, 1 | -1> {
	return { [sort.field]: sort.direction, _id: sort.direction };
}

function cursorValue(value: unknown): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Turn an over-fetched result set (limit + 1) into a page. The extra row is
 * what proves more data exists; it is never returned to the client.
 */
export function buildPage<T extends { _id: unknown }>(
	docs: T[],
	request: PageRequest,
	sort: SortKey = CREATED_DESC,
): Page<T> {
	const hasMore = docs.length > request.limit;
	const page = hasMore ? docs.slice(0, request.limit) : docs;
	const last = page.at(-1) as (T & Record<string, unknown>) | undefined;

	return {
		data: page,
		pagination: {
			nextCursor:
				hasMore && last
					? encodeCursor({
							at: cursorValue(last[sort.field]),
							id: String(last._id),
						})
					: null,
			hasMore,
			limit: request.limit,
		},
	};
}

/**
 * Keyset predicate for `sort`. Mongo needs the `_id` tie-breaker because many
 * records can share a sort value, and it must be compared as an ObjectId —
 * BSON never orders a string against an ObjectId, so a string id would match
 * nothing and silently drop every tied row.
 */
export function keysetFilter(
	cursor: Cursor | null,
	sort: SortKey = CREATED_DESC,
): Record<string, unknown> {
	if (!cursor || !Types.ObjectId.isValid(cursor.id)) {
		return {};
	}
	const op = sort.direction === -1 ? "$lt" : "$gt";
	const at = sort.kind === "date" ? new Date(cursor.at) : cursor.at;
	if (at instanceof Date && Number.isNaN(at.getTime())) {
		return {};
	}
	const id = new Types.ObjectId(cursor.id);
	return {
		$or: [
			{ [sort.field]: { [op]: at } },
			{ [sort.field]: at, _id: { [op]: id } },
		],
	};
}
