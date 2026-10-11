import { describe, expect, it } from "vitest";

import {
	classifyCgpa,
	computeCgpa,
	computeGpa,
	DEGREE_CGPA_THRESHOLD,
	deriveGrade,
	GRADING_SCALE,
	isGradeImprovementEligible,
	round2,
} from "@/lib/grading";

describe("deriveGrade", () => {
	it("maps each band boundary to the right letter grade", () => {
		const cases: [number, string][] = [
			[100, "A+"],
			[80, "A+"],
			[79, "A"],
			[75, "A"],
			[74, "A-"],
			[70, "A-"],
			[69, "B+"],
			[65, "B+"],
			[60, "B"],
			[55, "B-"],
			[50, "C+"],
			[45, "C"],
			[40, "C-"],
			[35, "D"],
			[34.9, "F"],
			[0, "F"],
		];

		for (const [percentage, expected] of cases) {
			const result = deriveGrade(percentage, 100);
			expect(result.letterGrade, `${percentage}% should be ${expected}`).toBe(expected);
		}
	});

	it("scales marks against the assessment's own maximum", () => {
		// 18/20 is 90%, not 18%.
		expect(deriveGrade(18, 20).letterGrade).toBe("A+");
		expect(deriveGrade(36, 40).letterGrade).toBe("A+");
	});

	it("treats F as a backlog that stays on the record", () => {
		const failed = deriveGrade(20, 100);
		expect(failed.letterGrade).toBe("F");
		expect(failed.status).toBe("BACKLOG");
		// Zero points, but excluded from the GPA rather than dragging it down.
		expect(failed.gradePoint).toBe(0);
		expect(failed.countsTowardGPA).toBe(false);
		expect(failed.countsAsEarnedCredit).toBe(false);
	});

	it("gives D an earned credit and counts it toward the GPA", () => {
		const d = deriveGrade(35, 100);
		expect(d.letterGrade).toBe("D");
		expect(d.status).toBe("PASSED");
		expect(d.countsAsEarnedCredit).toBe(true);
		expect(d.countsTowardGPA).toBe(true);
	});

	it("never derives I from marks, and gives it no grade point", () => {
		// Even a perfect score cannot produce I — I is asserted, not earned.
		expect(deriveGrade(100, 100, true).letterGrade).toBe("I");
		expect(deriveGrade(0, 100, true).gradePoint).toBeNull();
	});

	it("distinguishes I from F rather than collapsing them", () => {
		const incomplete = deriveGrade(0, 100, true);
		const failed = deriveGrade(0, 100, false);
		expect(incomplete.status).toBe("INCOMPLETE");
		expect(failed.status).toBe("BACKLOG");
		expect(incomplete.letterGrade).not.toBe(failed.letterGrade);
	});

	it("rejects a non-positive maximum instead of dividing by zero", () => {
		expect(() => deriveGrade(10, 0)).toThrow(RangeError);
	});
});

describe("computeGpa", () => {
	it("is credit-weighted, not a plain mean of grade points", () => {
		const summary = computeGpa([
			{ credits: 4, gradePoint: 4.0, countsTowardGPA: true },
			{ credits: 1, gradePoint: 2.0, countsTowardGPA: true },
		]);
		// (16 + 2) / 5 = 3.6, whereas the unweighted mean would be 3.0.
		expect(summary.gpa).toBe(3.6);
	});

	it("excludes an F from both the numerator and the denominator", () => {
		const withFail = computeGpa([
			{ credits: 3, gradePoint: 4.0, countsTowardGPA: true },
			{ credits: 3, gradePoint: 0, countsTowardGPA: false },
		]);
		// Counting the F's credits in the denominator would give 2.0.
		expect(withFail.gpa).toBe(4.0);
		expect(withFail.totalCredits).toBe(3);
		expect(withFail.coursesCounted).toBe(1);
	});

	it("excludes an I, which has a null grade point", () => {
		const summary = computeGpa([
			{ credits: 3, gradePoint: 3.5, countsTowardGPA: true },
			{ credits: 3, gradePoint: null, countsTowardGPA: false },
		]);
		expect(summary.gpa).toBe(3.5);
		expect(summary.coursesCounted).toBe(1);
	});

	it("returns null rather than NaN when nothing counts", () => {
		expect(computeGpa([]).gpa).toBeNull();
		expect(computeGpa([{ credits: 3, gradePoint: null, countsTowardGPA: false }]).gpa).toBeNull();
	});

	it("keeps intermediate sums unrounded", () => {
		// 1 credit at 3.75 and 2 credits at 3.33... never occurs on the real
		// scale, but the point is that the stored sum is exact.
		const summary = computeGpa([
			{ credits: 3, gradePoint: 3.75, countsTowardGPA: true },
			{ credits: 2, gradePoint: 3.5, countsTowardGPA: true },
		]);
		expect(summary.totalWeightedPoints).toBe(18.25);
		expect(summary.gpa).toBe(3.65);
	});
});

describe("computeCgpa", () => {
	it("differs from averaging already-rounded semester GPAs", () => {
		// Two semesters whose rounded GPAs average to 3.63, but whose true
		// credit-weighted mean is 3.5 — averaging the rounded figures is wrong.
		const semesterOne = computeGpa([
			{ credits: 3, gradePoint: 4.0, countsTowardGPA: true },
			{ credits: 3, gradePoint: 3.5, countsTowardGPA: true },
		]);
		const semesterTwo = computeGpa([
			{ credits: 3, gradePoint: 3.0, countsTowardGPA: true },
		]);

		const naiveAverage = round2((semesterOne.gpa! + semesterTwo.gpa!) / 2);
		const cumulative = computeCgpa([
			{ credits: 3, gradePoint: 4.0, countsTowardGPA: true },
			{ credits: 3, gradePoint: 3.5, countsTowardGPA: true },
			{ credits: 3, gradePoint: 3.0, countsTowardGPA: true },
		]);

		// Averaging the two rounded figures reports 3.38; the true
		// credit-weighted mean across all nine credits is 3.5.
		expect(naiveAverage).toBe(3.38);
		expect(cumulative.gpa).toBe(3.5);
	});
});

describe("round2", () => {
	it("rounds to two decimal places", () => {
		expect(round2(3.745)).toBe(3.75);
		expect(round2(3.7)).toBe(3.7);
		expect(round2(4)).toBe(4);
	});

	it("cannot recover a digit the float never held", () => {
		// 2.005 is stored as 2.0049999999999998934, so 2.00 is the only
		// correct answer. Asserted explicitly because a future reader will
		// otherwise assume this is a bug and "fix" it.
		expect(round2(2.005)).toBe(2);
	});
});

describe("classifyCgpa", () => {
	it("applies the institution's boundaries", () => {
		expect(classifyCgpa(3.75).classification).toBe("FIRST_CLASS_WITH_HONORS");
		expect(classifyCgpa(3.74).classification).toBe("FIRST_CLASS");
		expect(classifyCgpa(3.0).classification).toBe("FIRST_CLASS");
		expect(classifyCgpa(2.99).classification).toBe("SECOND_CLASS");
		expect(classifyCgpa(DEGREE_CGPA_THRESHOLD).classification).toBe("SECOND_CLASS");
		expect(classifyCgpa(2.19).classification).toBe("FAIL");
	});

	it("treats exactly 2.20 as degree-eligible", () => {
		expect(classifyCgpa(2.2).isDegreeEligible).toBe(true);
		expect(classifyCgpa(2.19).isDegreeEligible).toBe(false);
	});

	it("reports an unstarted record as in progress, not a fail", () => {
		expect(classifyCgpa(null).classification).toBe("IN_PROGRESS");
		expect(classifyCgpa(null).isDegreeEligible).toBe(false);
	});
});

describe("isGradeImprovementEligible", () => {
	it("applies only to a D while below the threshold", () => {
		expect(isGradeImprovementEligible("D", 2.0)).toBe(true);
		expect(isGradeImprovementEligible("D", 3.0)).toBe(false);
		expect(isGradeImprovementEligible("C-", 2.0)).toBe(false);
		expect(isGradeImprovementEligible("F", 1.0)).toBe(false);
	});
});

describe("GRADING_SCALE", () => {
	it("is frozen, so a caller cannot mutate the shared table", () => {
		expect(Object.isFrozen(GRADING_SCALE)).toBe(true);
	});

	it("has strictly descending, non-overlapping bounds", () => {
		const finite = GRADING_SCALE.filter((band) => Number.isFinite(band.minPercentage));
		for (let i = 1; i < finite.length; i += 1) {
			expect(finite[i].minPercentage).toBeLessThan(finite[i - 1].minPercentage);
		}
	});

	it("flags F as the only band that fails", () => {
		const failing = GRADING_SCALE.filter((band) => !band.countsAsEarnedCredit);
		expect(failing.map((band) => band.letterGrade)).toEqual(["F"]);
	});
});
