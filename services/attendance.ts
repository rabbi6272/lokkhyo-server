import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
	buildPage,
	keysetFilter,
	type Page,
	type PageRequest,
	sortSpec,
	type SortKey,
} from "@/lib/pagination";
import {
	Attendance as AttendanceModel,
	Course as CourseModel,
	Routine as RoutineModel,
} from "@/models";
import type {
	AmendAttendanceInput,
	ListAttendanceQuery,
	PutAttendanceInput,
} from "@/schemas/attendance";

const DATE_DESC: SortKey = { field: "date", direction: -1, kind: "string" };

/** A lean Mongo document: the service layer never speaks API shapes. */
type Lean = { createdAt: Date; updatedAt: Date; _id: Types.ObjectId } & Record<string, unknown>;

let indexesReady: Promise<void> | null = null;

/**
 * Bring the attendance indexes in line with the schema, once per process.
 *
 * `syncIndexes` drops indexes the schema no longer declares — here the old
 * `(userId, courseId, date)` unique index, which would otherwise reject the
 * second slot of a course on the same day.
 */
function ensureAttendanceIndexes(): Promise<void> {
	indexesReady ??= AttendanceModel.syncIndexes()
		.then(() => undefined)
		.catch((error: unknown) => {
			indexesReady = null;
			throw error;
		});
	return indexesReady;
}

async function assertCourse(userId: string, courseId: string) {
	const course = await CourseModel.findOne({
		_id: new Types.ObjectId(courseId),
		userId,
	}).lean<{ _id: Types.ObjectId }>();
	if (!course) {
		throw notFound("Course not found");
	}
	return course;
}

export async function listAttendance(
	userId: string,
	page: PageRequest,
	query: ListAttendanceQuery,
): Promise<Page<Lean>> {
	await connect();
	const docs = await AttendanceModel.find({
		userId,
		...(query.courseId ? { courseId: new Types.ObjectId(query.courseId) } : {}),
		...(query.from || query.to
			? {
					date: {
						...(query.from ? { $gte: query.from } : {}),
						...(query.to ? { $lte: query.to } : {}),
					},
				}
			: {}),
		...keysetFilter(page.cursor, DATE_DESC),
	})
		.sort(sortSpec(DATE_DESC))
		.limit(page.limit + 1)
		.lean<Lean[]>();
	return buildPage(docs, page, DATE_DESC);
}

/**
 * `PUT` on the natural key `(courseId, date)`.
 *
 * There is no record id in the path: a session is identified by when it
 * happened, so the client re-marks the same slot idempotently. This is why
 * marking attendance needs no idempotency key while a result post does — a
 * retried mark overwrites the same row rather than creating a second one.
 */
export async function putAttendance(
	userId: string,
	courseId: string,
	input: PutAttendanceInput,
): Promise<Lean> {
	await connect();
	await ensureAttendanceIndexes();
	const course = await assertCourse(userId, courseId);
	const slotId = input.slotId ?? null;

	// A slot id from another course (or another student) would file the
	// session under a class that is not this one.
	if (slotId) {
		const slot = await RoutineModel.exists({
			_id: new Types.ObjectId(slotId),
			userId,
			courseId: course._id,
		});
		if (!slot) {
			throw notFound("Routine slot not found for this course");
		}
	}

	const doc = await AttendanceModel.findOneAndUpdate(
		{ userId, courseId: course._id, date: input.date, slotId },
		{
			$set: {
				status: input.status,
				note: input.note ?? null,
			},
		},
		{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
	).lean<Lean>();

	return doc;
}

export async function updateAttendance(
	userId: string,
	id: string,
	input: AmendAttendanceInput,
): Promise<Lean> {
	await connect();
	const updated = await AttendanceModel.findOneAndUpdate(
		{ _id: new Types.ObjectId(id), userId },
		{
			$set: {
				...(input.status !== undefined ? { status: input.status } : {}),
				...(input.note !== undefined ? { note: input.note } : {}),
			},
		},
		{ returnDocument: "after" },
	).lean<Lean>();

	if (!updated) {
		throw notFound("Attendance record not found");
	}
	return updated;
}

export async function deleteAttendance(userId: string, id: string): Promise<void> {
	await connect();
	const deleted = await AttendanceModel.deleteOne({ _id: new Types.ObjectId(id), userId });
	if (deleted.deletedCount === 0) {
		throw notFound("Attendance record not found");
	}
}

/**
 * Attendance percentage is a display convenience, not the source of truth.
 *
 * The lenient default counts LATE and EXCUSED as attended, because that is
 * what most institutions do absent an explicit policy. All four counts are
 * returned alongside it so a client enforcing a stricter local rule — a
 * department that treats LATE as a half-absent, say — can compute its own
 * number without a server change.
 */
export interface SummaryRollup {
	courseId: string;
	courseCode: string;
	courseTitle: string;
	totalSessions: number;
	presentCount: number;
	lateCount: number;
	excusedCount: number;
	absentCount: number;
	cancelledCount: number;
	/** `null` until at least one session is recorded. */
	percentage: number | null;
	pendingSessions: number;
}

export async function attendanceSummary(
	userId: string,
	courseId: string,
	timezone: string,
): Promise<SummaryRollup> {
	await connect();

	const course = await CourseModel.findOne({
		_id: new Types.ObjectId(courseId),
		userId,
	}).lean<{ _id: Types.ObjectId; code: string; title: string }>();

	if (!course) {
		throw notFound("Course not found");
	}

	const rows = await AttendanceModel.aggregate<{ _id: string; count: number }>([
		{ $match: { userId, courseId: course._id } },
		{ $group: { _id: "$status", count: { $sum: 1 } } },
	]);

	// Statuses are stored UPPER_SNAKE; the rollup keys are their lowercase.
	const counts = { present: 0, late: 0, excused: 0, absent: 0, cancelled: 0 };
	for (const row of rows) {
		const key = row._id.toLowerCase() as keyof typeof counts;
		if (key in counts) {
			counts[key] = row.count;
		}
	}

	const totalSessions = counts.present + counts.late + counts.excused + counts.absent;
	const attended = counts.present + counts.late + counts.excused;

	// Records dated today or later can still be amended, so they are not final.
	const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
	const pendingSessions = await AttendanceModel.countDocuments({
		userId,
		courseId: course._id,
		date: { $gte: today },
		status: { $ne: "CANCELLED" },
	});

	return {
		courseId: course._id.toHexString(),
		courseCode: course.code,
		courseTitle: course.title,
		totalSessions,
		presentCount: counts.present,
		lateCount: counts.late,
		excusedCount: counts.excused,
		absentCount: counts.absent,
		cancelledCount: counts.cancelled,
		percentage: totalSessions === 0 ? null : Math.round((attended / totalSessions) * 100),
		pendingSessions,
	};
}
