import { describe, expect, it } from "vitest";

import { ok, okPage } from "@/lib/http";

describe("response envelopes", () => {
	it("wraps a single resource as { data }", async () => {
		expect(await ok({ id: "x" }).json()).toEqual({ data: { id: "x" } });
	});

	it("sends a list page as { data, pagination }, not nested in another data", async () => {
		const page = { data: [{ id: "x" }], pagination: { nextCursor: null, hasMore: false, limit: 20 } };
		const body = await okPage(page).json();
		expect(body).toEqual(page);
		expect(Array.isArray(body.data)).toBe(true);
	});
});
