import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { buildPage, keysetFilter, type Page, type PageRequest } from "@/lib/pagination";
import {
	Assessment as AssessmentModel,
	Attendance as AttendanceModel,
	Course as CourseModel,
	Deadline as DeadlineModel,
	Result as ResultModel,
	Routine as RoutineModel,
	Semester as SemesterModel,
	User as UserModel,
} from "@/models";
import { assertNoDependents, clearSemesterGpa, recomputeGpa } from "@/services/gpa";
import { assertSemesterDates, endDateFromWeeks } from "@/schemas/semester";
import type { CreateSemesterInput, UpdateSemesterInput } from "@/schemas/semester";

/** A lean Mongo document. The service layer never speaks API shapes. */
type Lean = { createdAt: Date; updatedAt: Date; _id: Types.ObjectId } & Record<
	string,
	unknown
>;


export async function listSemesters(
	userId: string,
	page: PageRequest,
): Promise<Page<Lean>> {
	await connect();
	const docs = await SemesterModel.find({ userId, ...keysetFilter(page.cursor) })
		.sort({ createdAt: -1, _id: -1 })
		.limit(page.limit + 1)
		.lean<Lean[]>();
	return buildPage(docs, page);
}

export async function getSemester(userId: string, id: string): Promise<Lean> {
	await connect();
	const semester = await SemesterModel.findOne({
		_id: new Types.ObjectId(id),
		userId,
	}).lean<Lean>();
	if (!semester) {
		throw notFound("Semester not found");
	}
	return semester;
}

export async function createSemester(
	userId: string,
	input: CreateSemesterInput,
): Promise<Lean> {
	await connect();
	const endDate =
		typeof input.totalWeeks === "number" && input.endDate === undefined
			? endDateFromWeeks(input.startDate, input.totalWeeks)
			: input.endDate;
	const created = await SemesterModel.create({ ...input, endDate, userId });
	return created.toObject() as Lean;
}

export async function updateSemester(
	userId: string,
	id: string,
	input: UpdateSemesterInput,
): Promise<Lean> {
	await connect();

	const existing = await SemesterModel.findOne({
		_id: new Types.ObjectId(id),
		userId,
	}).lean<{ startDate: string; endDate: string; totalWeeks: number | null }>();

	if (!existing) {
		throw notFound("Semester not found");
	}

	// A patch carrying only `startDate` cannot be validated on its own: whether
	// it inverts the term depends on the stored `endDate`. Validate the merged
	// result, which is the first moment both halves are known.
	const startDate = input.startDate ?? existing.startDate;
	const weeks = input.totalWeeks === undefined ? existing.totalWeeks : input.totalWeeks;
	// A term defined by its week count keeps its end date in step whenever the
	// start or the count moves, unless the client sends an explicit endDate.
	const endDate =
		input.endDate ??
		(typeof weeks === "number" &&
		(input.startDate !== undefined || input.totalWeeks !== undefined)
			? endDateFromWeeks(startDate, weeks)
			: existing.endDate);
	assertSemesterDates(startDate, endDate);

	const updated = await SemesterModel.findOneAndUpdate(
		{ _id: new Types.ObjectId(id), userId },
		{ $set: { ...input, endDate } },
		{ new: true },
	).lean<Lean>();

	if (!updated) {
		throw notFound("Semester not found");
	}
	return updated;
}

/**
 * Delete a semester, optionally cascading.
 *
 * MongoDB has no referential actions, so a cascade has to be written out. The
 * default is to refuse when children exist: silently deleting a term of courses,
 * attendance and results would move the student's CGPA with no visible cause,
 * so that requires `?cascade=true` and, in the app, a confirmation.
 */
export async function deleteSemester(
	userId: string,
	id: string,
	cascade: boolean,
): Promise<void> {
	await connect();
	const objectId = new Types.ObjectId(id);

	const semester = await SemesterModel.findOne({ _id: objectId, userId }).lean();
	if (!semester) {
		throw notFound("Semester not found");
	}

	if (!cascade) {
		await assertNoDependents(userId, objectId);
	} else {
		const courses = await CourseModel.find({ userId, semesterId: objectId })
			.select("_id")
			.lean<Array<{ _id: Types.ObjectId }>>();
		const courseIds = courses.map((course) => course._id);
		if (courseIds.length > 0) {
			await Promise.all([
				AttendanceModel.deleteMany({ userId, courseId: { $in: courseIds } }),
				AssessmentModel.deleteMany({ userId, courseId: { $in: courseIds } }),
				ResultModel.deleteMany({ userId, courseId: { $in: courseIds } }),
				RoutineModel.deleteMany({ userId, courseId: { $in: courseIds } }),
				DeadlineModel.deleteMany({ userId, courseId: { $in: courseIds } }),
			]);
			await CourseModel.deleteMany({ userId, _id: { $in: courseIds } });
		}
	}

	await clearSemesterGpa(userId, objectId);
	await SemesterModel.deleteOne({ _id: objectId, userId });
	// The deleted results counted toward the cumulative, so it must move too.
	await recomputeGpa(userId);
}

/**
 * Make one semester the active term.
 *
 * Done server-side so the invariant "exactly one ACTIVE" is a single operation
 * rather than N client patches that can be interrupted halfway. The profile's
 * `currentSemesterId` is moved in the same step so the two never disagree.
 */
export async function activateSemester(userId: string, id: string): Promise<Lean> {
	await connect();
	const objectId = new Types.ObjectId(id);

	const exists = await SemesterModel.exists({ _id: objectId, userId });
	if (!exists) {
		throw notFound("Semester not found");
	}

	await SemesterModel.updateMany(
		{ userId, _id: { $ne: objectId }, status: "ACTIVE" },
		{ $set: { status: "ARCHIVED" } },
	);
	const activated = await SemesterModel.findOneAndUpdate(
		{ _id: objectId, userId },
		{ $set: { status: "ACTIVE" } },
		{ new: true },
	).lean<Lean>();
	await UserModel.updateOne({ firebaseUid: userId }, { $set: { currentSemesterId: id } });

	if (!activated) {
		throw notFound("Semester not found");
	}
	return activated;
}
