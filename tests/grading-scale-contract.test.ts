import { describe, expect, it } from "vitest";

import { gradingScaleDto } from "@/lib/grading";
import { gradingScaleSchema } from "@/schemas/grade";

/**
 * Regression guard for a bug that shipped silently.
 *
 * `GET /grading-scale` feeds `gradingScaleDto()` through `respond()`, which
 * runs `gradingScaleSchema.parse()`. The schema had drifted from the DTO — it
 * demanded a `bands` array and a `threshold` key the engine never emits — so
 * `.parse()` threw and the route 500'd for every caller. Nothing caught it
 * because no test ever compared the two.
 *
 * This pins the contract directly: the DTO must satisfy the schema. A future
 * change to either side now fails the build instead of failing in production.
 */
describe("grading-scale response contract", () => {
	const dto = gradingScaleDto();

	it("the served DTO satisfies the response schema", () => {
		expect(() => gradingScaleSchema.parse(dto)).not.toThrow();
	});

	it("every band the engine emits round-trips through the schema unchanged", () => {
		const parsed = gradingScaleSchema.parse(dto);
		expect(parsed.scale).toEqual(dto.scale);
		expect(parsed.degreeCgpaThreshold).toBe(dto.degreeCgpaThreshold);
		expect(parsed.classificationBoundaries).toEqual(dto.classificationBoundaries);
	});

	it("carries all 12 bands, with `I` as the only percentage-less one", () => {
		const parsed = gradingScaleSchema.parse(dto);
		// 11 letter grades from A+ to F, plus the asserted `I`.
		expect(parsed.scale).toHaveLength(12);
		const withoutPercentage = parsed.scale.filter((b) => b.minPercentage === null);
		expect(withoutPercentage.map((b) => b.letterGrade)).toEqual(["I"]);
	});

	it("reports `I` and `F` as excluded from GPA and earned credit", () => {
		const parsed = gradingScaleSchema.parse(dto);
		const excluded = parsed.scale.filter((b) => !b.countsTowardGPA);
		expect(excluded.map((b) => b.letterGrade).sort()).toEqual(["F", "I"]);
		// Every GPA-excluded band is also credit-excluded — the pairing the
		// engine relies on to keep F/I out of both numerator and denominator.
		for (const band of excluded) {
			expect(band.countsAsEarnedCredit).toBe(false);
		}
	});

	it("classifies against the same threshold it serves", () => {
		const parsed = gradingScaleSchema.parse(dto);
		const secondClass = parsed.classificationBoundaries.find(
			(b) => b.classification === "SECOND_CLASS",
		);
		expect(secondClass?.minCgpa).toBe(parsed.degreeCgpaThreshold);
	});
});
