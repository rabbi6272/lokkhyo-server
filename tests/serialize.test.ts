import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { respond, respondPage, serialize } from "@/lib/serialize";

/**
 * The serialization boundary.
 *
 * Every response passes through here, so these assertions are about the
 * contract the Flutter client codes against rather than about Mongo. The
 * central claim is that a response is *checked* against its schema, not merely
 * passed through: a model field that drifts should fail here.
 */
describe("serialize", () => {
	it("renames _id to id and stringifies the ObjectId", () => {
		const id = new Types.ObjectId();
		expect(serialize({ _id: id, title: "Algorithms" })).toEqual({
			id: id.toHexString(),
			title: "Algorithms",
		});
	});

	it("converts Dates to ISO-8601", () => {
		const at = new Date("2026-01-15T10:30:00.000Z");
		expect(serialize({ createdAt: at })).toEqual({
			createdAt: "2026-01-15T10:30:00.000Z",
		});
	});

	it("drops __v rather than exposing a storage detail", () => {
		expect(serialize({ _id: new Types.ObjectId(), __v: 7 })).not.toHaveProperty("__v");
	});

	it("converts nested ObjectIds and Dates, not just top-level ones", () => {
		const courseId = new Types.ObjectId();
		const result = serialize({
			courseId,
			attempts: [{ resultId: new Types.ObjectId(), recordedAt: new Date(0) }],
		}) as { courseId: string; attempts: Array<{ recordedAt: string }> };

		expect(result.courseId).toBe(courseId.toHexString());
		expect(result.attempts[0].recordedAt).toBe("1970-01-01T00:00:00.000Z");
	});

	it("handles a hydrated Mongoose document, which is not a plain object", () => {
		const id = new Types.ObjectId();
		const doc = {
			_id: id,
			title: "Algorithms",
			toObject() {
				return { _id: id, title: "Algorithms" };
			},
		};
		expect(serialize(doc)).toEqual({ id: id.toHexString(), title: "Algorithms" });
	});

	it("maps null through rather than dropping the key", () => {
		// A nullable field that vanished would be a contract change the client
		// could not distinguish from a value change.
		expect(serialize({ note: null })).toEqual({ note: null });
	});

	it("keeps a top-level array as an array", () => {
		const id = new Types.ObjectId();
		expect(serialize([{ _id: id }])).toEqual([{ id: id.toHexString() }]);
	});
});

describe("respond", () => {
	const schema = z.object({ id: z.string(), title: z.string() });

	it("serializes then validates", () => {
		expect(
			respond(schema, { _id: new Types.ObjectId(), title: "Algorithms" }),
		).toEqual({ id: expect.any(String), title: "Algorithms" });
	});

	it("throws when a field is missing, so drift cannot reach a client", () => {
		// The whole point of validating here: a renamed model field breaks the
		// build rather than silently disappearing from the response.
		expect(() => respond(schema, { _id: new Types.ObjectId() })).toThrow();
	});

	it("throws when a field has the wrong type", () => {
		expect(() =>
			respond(schema, { _id: new Types.ObjectId(), title: 42 }),
		).toThrow();
	});
});

describe("respondPage", () => {
	const itemSchema = z.object({ id: z.string() });
	const pageSchema = z.object({
		data: z.array(itemSchema),
		pagination: z.object({
			nextCursor: z.string().nullable(),
			hasMore: z.boolean(),
			limit: z.number(),
		}),
	});

	const page = (data: Array<{ _id: Types.ObjectId; createdAt: Date }>) => ({
		data,
		pagination: { nextCursor: "abc", hasMore: true, limit: 20 },
	});

	it("keeps the envelope and the cursor intact", () => {
		const id = new Types.ObjectId();
		expect(respondPage(pageSchema, page([{ _id: id, createdAt: new Date() }]))).toEqual({
			data: [{ id: id.toHexString() }],
			pagination: { nextCursor: "abc", hasMore: true, limit: 20 },
		});
	});

	it("emits an empty data array rather than omitting the key", () => {
		const result = respondPage(pageSchema, page([]));
		expect(result.data).toEqual([]);
	});
});
