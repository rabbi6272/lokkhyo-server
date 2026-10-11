import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
	classifyCgpa,
	DEGREE_CGPA_THRESHOLD,
	isGradeImprovementEligible,
	round2,
} from "@/lib/grading";
import { Course, Result, Semester } from "@/models";
import { readCgpa, readSemesterGpa } from "@/services/gpa";

/**
 * Read-only projections of the academic record.
 *
 * Everything here reads a stored aggregate. Nothing recomputes a GPA: it is an
 * official figure, and a value that changed depending on when it was asked for
 * would be indefensible in a transcript dispute. `recomputeGpa` runs on write.
 */

interface ResultRow {
	_id: Types.ObjectId;
	courseId: Types.ObjectId;
	semesterId: Types.ObjectId;
	attempt: number;
	isLatestAttempt: boolean;
	marksObtained: number;
	maxMarks: number;
	credits: number;
	letterGrade: string;
	gradePoint: number | null;
	status: string;
	countsAsEarnedCredit: boolean;
	createdAt: Date;
}

async function loadResults(userId: string): Promise<ResultRow[]> {
	return Result.find({ userId })
		.sort({ createdAt: 1 })
		.lean<ResultRow[]>();
}

async function courseDirectory(userId: string, results: ResultRow[]) {
	const ids = [...new Set(results.map((row) => String(row.courseId)))];
	const courses = await Course.find({
		userId,
		_id: { $in: ids.map((id) => new Types.ObjectId(id)) },
	})
		.select("title code")
		.lean<Array<{ _id: Types.ObjectId; title: string; code: string }>>();
	return new Map(courses.map((course) => [String(course._id), course]));
}

export async function gpaForSemester(userId: string, semesterId: string) {
	await connect();

	const semester = await Semester.findOne({
		_id: new Types.ObjectId(semesterId),
		userId,
	}).lean<{ _id: Types.ObjectId; name: string }>();
	if (!semester) {
		throw notFound("Semester not found");
	}

	return {
		semesterId: semester._id.toHexString(),
		gpa: await readSemesterGpa(userId, semester._id),
	};
}

/**
 * Degree eligibility.
 *
 * `improvementCandidates` is the actionable part: courses holding a D while the
 * CGPA sits below the threshold, which are exactly the courses a student may
 * repeat to raise it. It is recomputed on read rather than stored, because it
 * depends on the CGPA, which moves whenever any other result changes — a stored
 * flag would go stale and tell a student they could still repeat a course when
 * they can no longer.
 */
export async function degreeStatus(userId: string) {
	await connect();

	const results = await loadResults(userId);
	const latest = results.filter((row) => row.isLatestAttempt);
	const cgpa = await readCgpa(userId);
	const below = cgpa === null || cgpa < DEGREE_CGPA_THRESHOLD;

	const courses = await courseDirectory(userId, latest);

	return {
		cgpa,
		degreeCgpaThreshold: DEGREE_CGPA_THRESHOLD,
		...classifyCgpa(cgpa),
		totalCreditsEarned: round2(
			latest
				.filter((row) => row.countsAsEarnedCredit)
				.reduce((sum, row) => sum + row.credits, 0),
		),
		totalCreditsAttempted: round2(
			latest.reduce((sum, row) => sum + row.credits, 0),
		),
		backlogCount: latest.filter((row) => row.status === "BACKLOG").length,
		incompleteCount: latest.filter((row) => row.status === "INCOMPLETE").length,
		improvementCandidates: below
			? latest
					.filter(
						(row) =>
							isGradeImprovementEligible(
								row.letterGrade as Parameters<
									typeof isGradeImprovementEligible
								>[0],
								cgpa,
							),
					)
					.map((row) => ({
						courseId: String(row.courseId),
						courseCode: courses.get(String(row.courseId))?.code ?? "",
					}))
			: [],
	};
}

/**
 * Full transcript: one entry per course, with every attempt nested.
 *
 * Grouping by course rather than by result is what makes a retake legible — a
 * flat list of results makes a second attempt look like a second course. The
 * newest attempt is the one carrying the grade; superseded attempts are kept
 * beneath it, because a transcript that erased them would hide the history the
 * document exists to preserve.
 */
export async function transcript(userId: string) {
	await connect();

	const results = await loadResults(userId);
	const courses = await courseDirectory(userId, results);

	const byCourse = new Map<string, ResultRow[]>();
	for (const row of results) {
		const key = String(row.courseId);
		const bucket = byCourse.get(key) ?? [];
		bucket.push(row);
		byCourse.set(key, bucket);
	}

	const entries = [...byCourse.entries()].map(([courseId, rows]) => {
		// Sorted oldest-first by loadResults, so the last row is the newest.
		const attempts = [...rows].sort((a, b) => a.attempt - b.attempt);
		const current = attempts.at(-1)!;
		const course = courses.get(courseId);

		return {
			courseId,
			courseCode: course?.code ?? "",
			courseTitle: course?.title ?? "",
			semesterId: String(current.semesterId),
			credits: current.credits,
			letterGrade: current.letterGrade,
			gradePoint: current.gradePoint,
			status: current.status,
			countsAsEarnedCredit: current.countsAsEarnedCredit,
			attempts: attempts.map((row) => ({
				resultId: row._id.toHexString(),
				attempt: row.attempt,
				marksObtained: row.marksObtained,
				maxMarks: row.maxMarks,
				letterGrade: row.letterGrade,
				status: row.status,
				recordedAt: row.createdAt.toISOString(),
			})),
		};
	});

	return { entries, cgpa: await readCgpa(userId) };
}

