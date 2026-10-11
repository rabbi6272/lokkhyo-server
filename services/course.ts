import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import {
	buildPage,
	keysetFilter,
	type Page,
	type PageRequest,
} from "@/lib/pagination";
import {
	Assessment as AssessmentModel,
	Attendance as AttendanceModel,
	Course as CourseModel,
	Result as ResultModel,
	Routine as RoutineModel,
	Semester as SemesterModel,
} from "@/models";
import { recomputeGpa } from "@/services/gpa";
import type {
	CreateCourseInput,
	ScheduledClass,
	UpdateCourseInput,
} from "@/schemas/course";

/** A lean Mongo document: the service layer never speaks API shapes. */
type LeanCourse = { createdAt: Date; updatedAt: Date; _id: Types.ObjectId } & Record<string, unknown>;

export async function listCourses(
	userId: string,
	page: PageRequest,
	filters: { semesterId?: string },
): Promise<Page<LeanCourse>> {
	await connect();
	const docs = await CourseModel.find({
		userId,
		...(filters.semesterId ? { semesterId: new Types.ObjectId(filters.semesterId) } : {}),
		...keysetFilter(page.cursor),
	})
		.sort({ createdAt: -1, _id: -1 })
		.limit(page.limit + 1)
		.lean<LeanCourse[]>();
	return buildPage(docs, page);
}

export async function getCourse(userId: string, id: string): Promise<LeanCourse> {
	await connect();
	const course = await CourseModel.findOne({ _id: new Types.ObjectId(id), userId }).lean<LeanCourse>();
	if (!course) {
		throw notFound("Course not found");
	}
	return course;
}

export async function createCourse(
	userId: string,
	input: CreateCourseInput,
): Promise<LeanCourse> {
	await connect();

	const semester = await SemesterModel.findOne({
		_id: new Types.ObjectId(input.semesterId),
		userId,
	}).lean();
	if (!semester) {
		throw notFound("Semester not found");
	}

	const created = await CourseModel.create({
		userId,
		semesterId: new Types.ObjectId(input.semesterId),
		title: input.title,
		code: input.code,
		instructor: input.instructor ?? null,
		credits: input.credits,
	});
	return created.toObject() as LeanCourse;
}

export async function updateCourse(
	userId: string,
	id: string,
	input: UpdateCourseInput,
): Promise<LeanCourse> {
	await connect();

	if (input.semesterId) {
		const semester = await SemesterModel.findOne({
			_id: new Types.ObjectId(input.semesterId),
			userId,
		}).lean();
		if (!semester) {
			throw notFound("Semester not found");
		}
	}

	const updated = await CourseModel.findOneAndUpdate(
		{ _id: new Types.ObjectId(id), userId },
		{
			$set: {
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.code !== undefined ? { code: input.code } : {}),
				...(input.instructor !== undefined ? { instructor: input.instructor } : {}),
				...(input.credits !== undefined ? { credits: input.credits } : {}),
				...(input.semesterId
					? { semesterId: new Types.ObjectId(input.semesterId) }
					: {}),
			},
		},
		{ new: true },
	).lean<LeanCourse>();

	if (!updated) {
		throw notFound("Course not found");
	}
	return updated;
}

/**
 * Editing a course's credits does not restate the transcript.
 *
 * Results snapshot the credit value they were graded under, so a CGPA stays
 * exactly as it was recorded. Only results written from now on pick up the new
 * value. Recomputing is still required, because the aggregate is derived from
 * the results — which correctly did not change.
 */
export async function deleteCourse(
	userId: string,
	id: string,
	cascade: boolean,
): Promise<void> {
	await connect();
	const objectId = new Types.ObjectId(id);

	const course = await CourseModel.findOne({ _id: objectId, userId }).lean();
	if (!course) {
		throw notFound("Course not found");
	}

	if (!cascade) {
		const [attendance, assessments, results, slots] = await Promise.all([
			AttendanceModel.countDocuments({ userId, courseId: objectId }),
			AssessmentModel.countDocuments({ userId, courseId: objectId }),
			ResultModel.countDocuments({ userId, courseId: objectId }),
			RoutineModel.countDocuments({ userId, courseId: objectId }),
		]);
		const dependents = {
			attendance,
			assessments,
			results,
			routineSlots: slots,
		};
		const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
		if (total > 0) {
			throw conflict(
				"This course still has related records. Delete them first, or repeat the request with ?cascade=true.",
				dependents,
			);
		}
	} else {
		await Promise.all([
			AttendanceModel.deleteMany({ userId, courseId: objectId }),
			AssessmentModel.deleteMany({ userId, courseId: objectId }),
			ResultModel.deleteMany({ userId, courseId: objectId }),
			RoutineModel.deleteMany({ userId, courseId: objectId }),
		]);
	}

	await CourseModel.deleteOne({ _id: objectId, userId });
	await recomputeGpa(userId);
}

export async function listRoutine(userId: string, courseId: string) {
	await connect();
	return RoutineModel.find({ userId, courseId: new Types.ObjectId(courseId) })
		.sort({ dayOfWeek: 1, startTime: 1 })
		.lean();
}

/**
 * Replace the course's whole weekly slot set.
 *
 * `PUT` rather than `PATCH` because a timetable is a bounded document: the
 * client always knows the complete set, so replacement is simpler than
 * per-slot add/remove and is idempotent without an idempotency key.
 */
export async function replaceRoutine(
	userId: string,
	courseId: string,
	slots: Array<{
		dayOfWeek: string;
		startTime: string;
		endTime: string;
		room: string | null;
	}>,
) {
	await connect();

	const objectId = new Types.ObjectId(courseId);
	const course = await CourseModel.findOne({ _id: objectId, userId }).lean();
	if (!course) {
		throw notFound("Course not found");
	}

	await RoutineModel.deleteMany({ userId, courseId: objectId });
	if (slots.length > 0) {
		await RoutineModel.insertMany(
			slots.map((slot) => ({ ...slot, userId, courseId: objectId })),
		);
	}

	return RoutineModel.find({ userId, courseId: objectId })
		.sort({ dayOfWeek: 1, startTime: 1 })
		.lean();
}

const DAY_NAMES = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
] as const;

/**
 * Resolve routine slots onto a specific calendar date.
 *
 * `dayOfWeek` is computed in the caller's timezone, not the server's. A student
 * in Dhaka asking for "today" at 01:00 local gets Friday's classes even though
 * UTC has already rolled into Saturday — using `new Date().getDay()` here would
 * hand them the wrong day's schedule.
 */
export async function routineForDate(
	userId: string,
	timezone: string,
	date?: string,
): Promise<ScheduledClass[]> {
	await connect();

	const target = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
	const dayOfWeek = DAY_NAMES[new Date(`${target}T12:00:00Z`).getUTCDay()];

	const rows = await RoutineModel.aggregate<{
		_id: Types.ObjectId;
		dayOfWeek: string;
		startTime: string;
		endTime: string;
		room: string | null;
		courseId: Types.ObjectId;
		title: string;
		code: string;
	}>([
		{ $match: { userId, dayOfWeek } },
		{
			$lookup: {
				from: "courses",
				localField: "courseId",
				foreignField: "_id",
				as: "course",
			},
		},
		{ $unwind: "$course" },
		{
			$project: {
				dayOfWeek: 1,
				startTime: 1,
				endTime: 1,
				room: 1,
				courseId: 1,
				title: "$course.title",
				code: "$course.code",
			},
		},
		{ $sort: { startTime: 1 } },
	]);

	return rows.map((row) => ({
		id: row._id,
		courseId: row.courseId,
		dayOfWeek: row.dayOfWeek,
		startTime: row.startTime,
		endTime: row.endTime,
		room: row.room,
		course: { id: row.courseId, title: row.title, code: row.code },
	})) as unknown as ScheduledClass[];
}
