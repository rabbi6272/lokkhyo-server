import type { LetterGrade, ResultStatus } from "@/schemas/common";

/**
 * The grading engine.
 *
 * Every function here is pure: no database, no clock, no I/O. That is a
 * deliberate constraint, not an accident of layering. The Flutter what-if
 * simulator reimplements the *arithmetic* against the scale served by
 * `GET /api/v1/grading-scale`, and it can only stay honest if the arithmetic is
 * simple and total. Keeping it here, with no way to reach for a database, is
 * what makes that guarantee reviewable.
 */

/** Minimum cumulative CGPA for the degree to be awarded. */
export const DEGREE_CGPA_THRESHOLD = 2.2;

export interface GradeBand {
	letterGrade: LetterGrade;
	/** Inclusive lower bound, as a percentage of max marks. */
	minPercentage: number;
	/** `null` only for `I`, which has no point value. */
	gradePoint: number | null;
	/** Whether the band contributes to the GPA numerator and denominator. */
	countsTowardGPA: boolean;
	/** Whether the course's credits are earned. */
	countsAsEarnedCredit: boolean;
}

/**
 * RUET / BUET scale. `I` is modelled as a band with no numeric lower bound
 * because it is never derived from marks — it is asserted by an instructor or
 * the student, and must never be reachable by scoring badly. Treating `I` as
 * just another low band is exactly the bug this shape prevents.
 */
export const GRADING_SCALE: readonly GradeBand[] = Object.freeze([
	{ letterGrade: "A+", minPercentage: 80, gradePoint: 4.0, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "A", minPercentage: 75, gradePoint: 3.75, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "A-", minPercentage: 70, gradePoint: 3.5, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "B+", minPercentage: 65, gradePoint: 3.25, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "B", minPercentage: 60, gradePoint: 3.0, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "B-", minPercentage: 55, gradePoint: 2.75, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "C+", minPercentage: 50, gradePoint: 2.5, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "C", minPercentage: 45, gradePoint: 2.25, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "C-", minPercentage: 40, gradePoint: 2.0, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "D", minPercentage: 35, gradePoint: 1.5, countsTowardGPA: true, countsAsEarnedCredit: true },
	{ letterGrade: "F", minPercentage: 0, gradePoint: 0.0, countsTowardGPA: false, countsAsEarnedCredit: false },
]);

export const INCOMPLETE_BAND: GradeBand = Object.freeze({
	letterGrade: "I",
	minPercentage: Number.POSITIVE_INFINITY,
	gradePoint: null,
	countsTowardGPA: false,
	countsAsEarnedCredit: false,
});

/** The serialisable shape served by `GET /api/v1/grading-scale`. */
export interface GradingScaleDto {
	scale: {
		letterGrade: LetterGrade;
		minPercentage: number | null;
		gradePoint: number | null;
		countsTowardGPA: boolean;
		countsAsEarnedCredit: boolean;
	}[];
	degreeCgpaThreshold: number;
	classificationBoundaries: { classification: string; minCgpa: number | null }[];
}

export function gradingScaleDto(): GradingScaleDto {
	return {
		scale: [...GRADING_SCALE, INCOMPLETE_BAND].map((band) => ({
			letterGrade: band.letterGrade,
			// `I` has no percentage; null is honest where Infinity would serialise
			// as null anyway and mislead anyone reading the JSON.
			minPercentage: Number.isFinite(band.minPercentage) ? band.minPercentage : null,
			gradePoint: band.gradePoint,
			countsTowardGPA: band.countsTowardGPA,
			countsAsEarnedCredit: band.countsAsEarnedCredit,
		})),
		degreeCgpaThreshold: DEGREE_CGPA_THRESHOLD,
		classificationBoundaries: [
			{ classification: "FIRST_CLASS_WITH_HONORS", minCgpa: 3.75 },
			{ classification: "FIRST_CLASS", minCgpa: 3.0 },
			{ classification: "SECOND_CLASS", minCgpa: DEGREE_CGPA_THRESHOLD },
			{ classification: "FAIL", minCgpa: null },
		],
	};
}

export interface DerivedGrade {
	letterGrade: LetterGrade;
	gradePoint: number | null;
	percentage: number;
	status: ResultStatus;
	countsTowardGPA: boolean;
	countsAsEarnedCredit: boolean;
}

/**
 * Marks to letter grade, grade point, and contribution flags.
 *
 * `incomplete` short-circuits to `I`. This is the one place the distinction
 * that matters most is encoded: `F` is a real outcome with real marks behind
 * it, `I` is an assertion that no outcome has been decided yet. They both sit
 * outside the GPA, but only one of them is a failure.
 */
export function deriveGrade(
	marksObtained: number,
	maxMarks: number,
	incomplete = false,
): DerivedGrade {
	if (incomplete) {
		return {
			letterGrade: "I",
			gradePoint: null,
			percentage: 0,
			status: "INCOMPLETE",
			countsTowardGPA: false,
			countsAsEarnedCredit: false,
		};
	}

	if (!(maxMarks > 0)) {
		throw new RangeError("maxMarks must be greater than zero");
	}

	const percentage = (marksObtained / maxMarks) * 100;
	const band =
		GRADING_SCALE.find((candidate) => percentage >= candidate.minPercentage) ??
		GRADING_SCALE[GRADING_SCALE.length - 1];

	return {
		letterGrade: band.letterGrade,
		gradePoint: band.gradePoint,
		percentage,
		// `F` is retained on the record permanently and flagged as backlog;
		// it is not discarded.
		status: band.letterGrade === "F" ? "BACKLOG" : "PASSED",
		countsTowardGPA: band.countsTowardGPA,
		countsAsEarnedCredit: band.countsAsEarnedCredit,
	};
}

/** A course result as the GPA calculation sees it. */
export interface GpaEntry {
	credits: number;
	gradePoint: number | null;
	countsTowardGPA: boolean;
}

export interface GpaSummary {
	/** Rounded to 2dp. The unrounded sums are returned alongside it. */
	gpa: number | null;
	totalCredits: number;
	totalWeightedPoints: number;
	coursesCounted: number;
}

/**
 * Round to 2 decimal places.
 *
 * `toFixed` is used rather than `Math.round(x * 100) / 100` because the latter
 * misrounds values like 3.745 through binary floating point. Only ever applied
 * to a final reported figure — never to an intermediate sum.
 */
export function round2(value: number): number {
	return Number.parseFloat(value.toFixed(2));
}

/**
 * Credit-weighted mean of grade points.
 *
 * F and I are excluded from *both* numerator and denominator, which is why
 * `countsTowardGPA` gates the credits too. Including an F's credits in the
 * denominator while excluding its zero points is the classic way to silently
 * depress a CGPA.
 */
export function computeGpa(entries: readonly GpaEntry[]): GpaSummary {
	let totalWeightedPoints = 0;
	let totalCredits = 0;
	let coursesCounted = 0;

	for (const entry of entries) {
		if (!entry.countsTowardGPA || entry.gradePoint === null) {
			continue;
		}
		totalWeightedPoints += entry.credits * entry.gradePoint;
		totalCredits += entry.credits;
		coursesCounted += 1;
	}

	return {
		gpa: totalCredits === 0 ? null : round2(totalWeightedPoints / totalCredits),
		// Sums stay unrounded; only `gpa` is rounded.
		totalWeightedPoints,
		totalCredits,
		coursesCounted,
	};
}

/**
 * Cumulative GPA.
 *
 * Always recomputed from every counted course result across all semesters,
 * never by averaging already-rounded semester GPAs — that compounds rounding
 * error and double-counts credits.
 */
export function computeCgpa(entries: readonly GpaEntry[]): GpaSummary {
	return computeGpa(entries);
}

export function classifyCgpa(cgpa: number | null): {
	classification: string;
	isDegreeEligible: boolean;
} {
	if (cgpa === null) {
		return { classification: "IN_PROGRESS", isDegreeEligible: false };
	}
	if (cgpa >= 3.75) {
		return { classification: "FIRST_CLASS_WITH_HONORS", isDegreeEligible: true };
	}
	if (cgpa >= 3.0) {
		return { classification: "FIRST_CLASS", isDegreeEligible: true };
	}
	if (cgpa >= DEGREE_CGPA_THRESHOLD) {
		return { classification: "SECOND_CLASS", isDegreeEligible: true };
	}
	return { classification: "FAIL", isDegreeEligible: false };
}

/**
 * A `D` is an earned credit but is the grade the institution allows a repeat to
 * improve. Eligibility is deliberately *not* automatic: the repeat is a separate
 * flow with its own result record, never a mutation of the original.
 */
export function isGradeImprovementEligible(
	letterGradeValue: LetterGrade,
	cgpa: number | null,
): boolean {
	return letterGradeValue === "D" && cgpa !== null && cgpa < DEGREE_CGPA_THRESHOLD;
}
