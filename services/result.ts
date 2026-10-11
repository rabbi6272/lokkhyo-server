import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
	buildPage,
	keysetFilter,
	type PageRequest,
} from "@/lib/pagination";
import { deriveGrade, isGradeImprovementEligible } from "@/lib/grading";
import { Assessment, Course, Result } from "@/models";
import { recomputeGpa, readCgpa, readSemesterGpa } from "@/services/gpa";

/** A lean Mongo document. The service layer never speaks API shapes. */
type LeanResult = {
	createdAt: Date;
	updatedAt: Date;
	_id: Types.ObjectId;
	letterGrade: string;
} & Record<string, unknown>;
import type {
	CreateResultInput,
	ListResultsQuery,
	UpdateResultInput,
} from "@/schemas/result";

/**
 * Recording a result.
 *
 * The write path does all the derivation — letter grade, grade point, status,
 * contribution flags, and the credit snapshot — in one place, so no code path
 * can persist a result whose derived fields disagree with the engine. The
 * transcript is a historical record: these values are written once and never
 * silently restated by a later edit to the course.
 */
export async function createResult(userId: string, input: CreateResultInput) {
	await connect();

	const assessment = await Assessment.findOne({
		_id: new Types.ObjectId(input.assessmentId),
		userId,
	}).lean<{
		_id: Types.ObjectId;
		courseId: Types.ObjectId;
		maxMarks: number;
	}>();

	if (!assessment) {
		throw notFound("Assessment not found");
	}

	const course = await Course.findOne({
		_id: assessment.courseId,
		userId,
	}).lean<{ _id: Types.ObjectId; semesterId: Types.ObjectId; credits: number }>();

	if (!course) {
		throw notFound("Course not found for this assessment");
	}

	// A regrade of the same assessment is a new attempt, not an overwrite. The
	// original result stays on the record so the transcript keeps its history.
	const previousAttempts = await Result.countDocuments({
		userId,
		courseId: course._id,
	});

	const derived = deriveGrade(
		input.marksObtained ?? 0,
		assessment.maxMarks,
		input.incomplete,
	);

	// Demote the previous latest attempt before promoting this one. The
	// partial unique index means the promotion and the demotion cannot both be
	// true at once, so the order is: clear, then insert.
	await Result.updateMany(
		{ userId, courseId: course._id, isLatestAttempt: true },
		{ $set: { isLatestAttempt: false } },
	);

	const created = await Result.create({
		userId,
		assessmentId: assessment._id,
		courseId: course._id,
		semesterId: course.semesterId,
		attempt: previousAttempts + 1,
		isLatestAttempt: true,
		// Snapshot, not a reference: see the note above.
		credits: course.credits,
		marksObtained: input.incomplete ? 0 : (input.marksObtained ?? 0),
		maxMarks: assessment.maxMarks,
		percentage: derived.percentage,
		letterGrade: derived.letterGrade,
		gradePoint: derived.gradePoint,
		status: derived.status,
		countsTowardGPA: derived.countsTowardGPA,
		countsAsEarnedCredit: derived.countsAsEarnedCredit,
	});

	const { cgpa } = await recomputeGpa(userId);
	const semesterGpa = await readSemesterGpa(userId, course.semesterId);

	const [result] = decorateResults([created.toObject()], cgpa);
	return { result, semesterGpa, cgpa };
}

/**
 * Amend a result in place.
 *
 * Re-derives and recomputes. `PUT` semantics mean the client sends the marks it
 * wants to be true, so a retry is naturally safe without an idempotency key.
 */
export async function updateResult(
	userId: string,
	resultId: string,
	input: UpdateResultInput,
) {
	await connect();

	const existing = await Result.findOne({
		_id: new Types.ObjectId(resultId),
		userId,
	}).lean<{
		_id: Types.ObjectId;
		courseId: Types.ObjectId;
		semesterId: Types.ObjectId;
		maxMarks: number;
		attempt: number;
	}>();

	if (!existing) {
		throw notFound("Result not found");
	}

	const derived = deriveGrade(
		input.marksObtained ?? 0,
		existing.maxMarks,
		input.incomplete,
	);

	const updated = await Result.findOneAndUpdate(
		{ _id: existing._id, userId },
		{
			$set: {
				marksObtained: input.incomplete ? 0 : (input.marksObtained ?? 0),
				percentage: derived.percentage,
				letterGrade: derived.letterGrade,
				gradePoint: derived.gradePoint,
				status: derived.status,
				countsTowardGPA: derived.countsTowardGPA,
				countsAsEarnedCredit: derived.countsAsEarnedCredit,
			},
		},
		{ new: true },
	);

	if (!updated) {
		throw notFound("Result not found");
	}

	// Amending a superseded attempt would leave the GPA stale, so recompute
	// whenever the amended row is the one being counted.
	if (updated.isLatestAttempt) {
		await recomputeGpa(userId);
	}

	const cgpa = await readCgpa(userId);
	const semesterGpa = await readSemesterGpa(userId, existing.semesterId);

	const [result] = decorateResults([updated.toObject()], cgpa);
	return { result, semesterGpa, cgpa };
}

export async function deleteResult(userId: string, resultId: string) {
	await connect();

	const deleted = await Result.findOneAndDelete({
		_id: new Types.ObjectId(resultId),
		userId,
	});

	if (!deleted) {
		throw notFound("Result not found");
	}

	// Deleting the latest attempt promotes the most recent remaining one, so the
	// course still contributes to the GPA rather than silently vanishing from it.
	if (deleted.isLatestAttempt) {
		const previous = await Result.findOne({ userId, courseId: deleted.courseId })
			.sort({ attempt: -1 })
			.lean<{ _id: Types.ObjectId }>();
		if (previous) {
			await Result.updateOne(
				{ _id: previous._id },
				{ $set: { isLatestAttempt: true } },
			);
		}
	}

	await recomputeGpa(userId);
}

/**
 * Attach the grade-improvement flag to a page of results.
 *
 * The flag is derived on read, not stored, because it depends on the CGPA —
 * which moves every time any other result changes. A stored flag would go stale
 * and tell a student they could repeat a course when they no longer can.
 *
 * The CGPA is read once for the whole page. Reading it per row would issue one
 * extra query per result, and all of them would return the same number.
 */
export function decorateResults<T extends { letterGrade: string }>(
	results: T[],
	cgpa: number | null,
): Array<T & { isGradeImprovementEligible: boolean }> {
	return results.map((result) => ({
		...result,
		isGradeImprovementEligible: isGradeImprovementEligible(
			result.letterGrade as Parameters<typeof isGradeImprovementEligible>[0],
			cgpa,
		),
	}));
}

export async function listResults(
	userId: string,
	page: PageRequest,
	query: ListResultsQuery,
) {
	await connect();

	const docs = await Result.find({
		userId,
		...(query.courseId ? { courseId: new Types.ObjectId(query.courseId) } : {}),
		...(query.semesterId ? { semesterId: new Types.ObjectId(query.semesterId) } : {}),
		...keysetFilter(page.cursor),
	})
		.sort({ createdAt: -1, _id: -1 })
		.limit(page.limit + 1)
		.lean<LeanResult[]>();

	return buildPage(decorateResults(docs, await readCgpa(userId)), page);
}
