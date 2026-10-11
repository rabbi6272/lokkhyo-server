import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { Course, GpaRecord, Result } from "@/models";
import { computeCgpa, computeGpa, type GpaEntry } from "@/lib/grading";

/**
 * Grade recomputation — compute-on-write.
 *
 * `GET /me/cgpa` reads a stored document; it never recomputes. The academic
 * record is an official figure, so it is derived once at the moment a result
 * changes and then read many times, rather than being re-derived per request
 * where two concurrent reads could disagree.
 *
 * The cost is irrelevant: a student has on the order of a hundred results, so
 * this is O(n) over one small collection.
 */
export interface GpaSnapshot {
	cgpa: number | null;
}

/**
 * Recompute every semester GPA plus the cumulative, and persist them.
 *
 * All semesters are recomputed rather than only the affected one. A student's
 * whole record is small, and the cumulative depends on all of it, so the
 * partial-update optimisation would save little while adding a class of bug
 * where a semester is silently left stale.
 */
export async function recomputeGpa(userId: string): Promise<GpaSnapshot> {
	await connect();

	const counted = await Result.find({ userId, isLatestAttempt: true })
		.select("semesterId credits gradePoint countsTowardGPA")
		.lean<Array<{
		semesterId: Types.ObjectId;
		credits: number;
		gradePoint: number | null;
		countsTowardGPA: boolean;
	}>>();

	const bySemester = new Map<string, GpaEntry[]>();
	for (const result of counted) {
		const key = String(result.semesterId);
		const bucket = bySemester.get(key) ?? [];
		bucket.push({
			credits: result.credits,
			gradePoint: result.gradePoint,
			countsTowardGPA: result.countsTowardGPA,
		});
		bySemester.set(key, bucket);
	}

	for (const [semesterId, entries] of bySemester) {
		const summary = computeGpa(entries);
		await GpaRecord.updateOne(
			{ userId, semesterId: new Types.ObjectId(semesterId) },
			{
				$set: {
					gpa: summary.gpa,
					// Unrounded, so a later cumulative recomputation is identical
					// to one computed from the results directly.
					totalCredits: summary.totalCredits,
					totalWeightedPoints: summary.totalWeightedPoints,
					coursesCounted: summary.coursesCounted,
				},
			},
			{ upsert: true },
		);
	}

	// A semester whose last counted result disappeared has no bucket above, so
	// its old record would otherwise linger and report a GPA built from rows
	// that no longer exist.
	await GpaRecord.deleteMany({
		userId,
		semesterId: {
			$ne: null,
			$nin: [...bySemester.keys()].map((id) => new Types.ObjectId(id)),
		},
	});

	// The cumulative record is the one with a null semesterId. The unique index
	// on (userId, semesterId) keeps it to a single document per student.
	const cumulative = computeCgpa(
		counted.map((result) => ({
			credits: result.credits,
			gradePoint: result.gradePoint,
			countsTowardGPA: result.countsTowardGPA,
		})),
	);

	await GpaRecord.updateOne(
		{ userId, semesterId: null },
		{
			$set: {
				gpa: cumulative.gpa,
				totalCredits: cumulative.totalCredits,
				totalWeightedPoints: cumulative.totalWeightedPoints,
				coursesCounted: cumulative.coursesCounted,
			},
		},
		{ upsert: true },
	);

	// Only the cumulative is returned. A caller that just wrote a result knows
	// which semester it landed in and reads that record itself, rather than
	// this function guessing.
	return { cgpa: cumulative.gpa };
}

export async function readSemesterGpa(
	userId: string,
	semesterId: Types.ObjectId | null,
): Promise<number | null> {
	await connect();
	const record = await GpaRecord.findOne({ userId, semesterId }).lean<{
		gpa: number | null;
	}>();
	return record?.gpa ?? null;
}

/** The stored cumulative row, or an empty aggregate before any result exists. */
export async function readCumulative(userId: string) {
	await connect();
	const record = await GpaRecord.findOne({ userId, semesterId: null }).lean<{
		gpa: number | null;
		totalCredits: number;
		coursesCounted: number;
	}>();
	return {
		cgpa: record?.gpa ?? null,
		totalCredits: record?.totalCredits ?? 0,
		coursesCounted: record?.coursesCounted ?? 0,
	};
}

export async function readCgpa(userId: string): Promise<number | null> {
	return readSemesterGpa(userId, null);
}

/**
 * Remove a semester's aggregate when the semester itself is deleted.
 *
 * MongoDB performs no referential action, so a cascade that is not written out
 * explicitly does not happen. This is the cascade, done on purpose.
 */
export async function clearSemesterGpa(userId: string, semesterId: Types.ObjectId) {
	await connect();
	await GpaRecord.deleteMany({ userId, semesterId });
}

/**
 * Guarded delete.
 *
 * Returns the number of children that would be orphaned, so the route can
 * refuse with 409 and tell the client exactly what a cascade would destroy.
 */
export async function countDependents(
	userId: string,
	semesterId: Types.ObjectId,
): Promise<{ courses: number }> {
	await connect();
	const courses = await Course.countDocuments({ userId, semesterId });
	return { courses };
}

export async function assertNoDependents(
	userId: string,
	semesterId: Types.ObjectId,
): Promise<void> {
	const { courses } = await countDependents(userId, semesterId);
	if (courses > 0) {
		throw conflict(
			"This semester still has courses. Delete them first, or repeat the request with ?cascade=true.",
			{ courses },
		);
	}
}
