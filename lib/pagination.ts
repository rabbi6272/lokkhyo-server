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
 * Turn an over-fetched result set (limit + 1) into a page. The extra row is
 * what proves more data exists; it is never returned to the client.
 */
export function buildPage<T extends { createdAt: Date; _id: unknown }>(
	docs: T[],
	request: PageRequest,
): Page<T> {
	const hasMore = docs.length > request.limit;
	const page = hasMore ? docs.slice(0, request.limit) : docs;
	const last = page.at(-1);

	return {
		data: page,
		pagination: {
			nextCursor:
				hasMore && last
					? encodeCursor({ at: last.createdAt.toISOString(), id: String(last._id) })
					: null,
			hasMore,
			limit: request.limit,
		},
	};
}

/**
 * Keyset predicate for a descending `(createdAt, _id)` sort. Mongo needs the
 * tie-breaker because many records can share a timestamp.
 */
export function keysetFilter(cursor: Cursor | null): Record<string, unknown> {
	if (!cursor) {
		return {};
	}
	const at = new Date(cursor.at);
	return {
		$or: [
			{ createdAt: { $lt: at } },
			{ createdAt: at, _id: { $lt: cursor.id } },
		],
	};
}
