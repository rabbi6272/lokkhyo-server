import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import {
	buildPage,
	CREATED_DESC,
	decodeCursor,
	keysetFilter,
	type SortKey,
	sortSpec,
} from "@/lib/pagination";

const DATE_DESC: SortKey = { field: "date", direction: -1, kind: "string" };
const DUE_ASC: SortKey = { field: "dueAt", direction: 1, kind: "date" };

describe("sortSpec", () => {
	it("tie-breaks on _id in the same direction", () => {
		expect(sortSpec(DUE_ASC)).toEqual({ dueAt: 1, _id: 1 });
		expect(sortSpec(DATE_DESC)).toEqual({ date: -1, _id: -1 });
	});
});

describe("buildPage", () => {
	it("encodes the cursor from the sort field, not createdAt", () => {
		const id = new Types.ObjectId();
		const docs = [
			{ _id: new Types.ObjectId(), date: "2026-10-12", createdAt: new Date(0) },
			{ _id: id, date: "2026-10-11", createdAt: new Date(0) },
			{ _id: new Types.ObjectId(), date: "2026-10-10", createdAt: new Date(0) },
		];
		const page = buildPage(docs, { limit: 2, cursor: null }, DATE_DESC);

		expect(page.data).toHaveLength(2);
		expect(page.pagination.hasMore).toBe(true);
		const cursor = decodeCursor(page.pagination.nextCursor ?? "");
		expect(cursor).toEqual({ at: "2026-10-11", id: id.toHexString() });
	});

	it("encodes a Date sort field as ISO", () => {
		const dueAt = new Date("2026-10-11T08:00:00.000Z");
		const docs = [
			{ _id: new Types.ObjectId(), dueAt },
			{ _id: new Types.ObjectId(), dueAt },
		];
		const page = buildPage(docs, { limit: 1, cursor: null }, DUE_ASC);
		expect(decodeCursor(page.pagination.nextCursor ?? "")?.at).toBe(
			dueAt.toISOString(),
		);
	});

	it("returns no cursor on the last page", () => {
		const page = buildPage(
			[{ _id: new Types.ObjectId(), createdAt: new Date() }],
			{ limit: 5, cursor: null },
		);
		expect(page.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 5 });
	});
});

describe("keysetFilter", () => {
	const id = new Types.ObjectId();

	it("is empty without a cursor", () => {
		expect(keysetFilter(null, DATE_DESC)).toEqual({});
	});

	it("uses $lt and a string value for a descending text key", () => {
		const filter = keysetFilter({ at: "2026-10-11", id: id.toHexString() }, DATE_DESC);
		expect(filter).toEqual({
			$or: [{ date: { $lt: "2026-10-11" } }, { date: "2026-10-11", _id: { $lt: id } }],
		});
	});

	it("uses $gt and a Date value for an ascending date key", () => {
		const at = "2026-10-11T08:00:00.000Z";
		const filter = keysetFilter({ at, id: id.toHexString() }, DUE_ASC) as {
			$or: [Record<string, { $gt: unknown }>, Record<string, unknown>];
		};
		expect(filter.$or[0].dueAt.$gt).toEqual(new Date(at));
	});

	it("compares the tie-breaker as an ObjectId, never a string", () => {
		const filter = keysetFilter(
			{ at: new Date().toISOString(), id: id.toHexString() },
			CREATED_DESC,
		) as { $or: [unknown, { _id: { $lt: unknown } }] };
		expect(filter.$or[1]._id.$lt).toBeInstanceOf(Types.ObjectId);
	});

	it("restarts from the beginning on a malformed cursor", () => {
		expect(keysetFilter({ at: "2026-10-11", id: "not-an-id" }, DATE_DESC)).toEqual({});
		expect(keysetFilter({ at: "garbage", id: id.toHexString() }, DUE_ASC)).toEqual({});
	});
});
