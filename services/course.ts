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
	Deadline as DeadlineModel,
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
		passMarks: input.passMarks ?? null,
		ctWeight: input.ctWeight ?? null,
		isLab: input.isLab ?? false,
		courseTeachers: input.courseTeachers ?? [],
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
				...(input.passMarks !== undefined ? { passMarks: input.passMarks } : {}),
				...(input.ctWeight !== undefined ? { ctWeight: input.ctWeight } : {}),
				...(input.isLab !== undefined ? { isLab: input.isLab } : {}),
				...(input.courseTeachers !== undefined
					? { courseTeachers: input.courseTeachers }
					: {}),
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
		const [attendance, assessments, results, slots, deadlines] = await Promise.all([
			AttendanceModel.countDocuments({ userId, courseId: objectId }),
			AssessmentModel.countDocuments({ userId, courseId: objectId }),
			ResultModel.countDocuments({ userId, courseId: objectId }),
			RoutineModel.countDocuments({ userId, courseId: objectId }),
			DeadlineModel.countDocuments({ userId, courseId: objectId }),
		]);
		const dependents = {
			attendance,
			assessments,
			results,
			routineSlots: slots,
			deadlines,
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
			DeadlineModel.deleteMany({ userId, courseId: objectId }),
		]);
	}

	await CourseModel.deleteOne({ _id: objectId, userId });
	await recomputeGpa(userId);
}

export async function listRoutine(userId: string, courseId: string) {
	await connect();
	const slots = await RoutineModel.find({
		userId,
		courseId: new Types.ObjectId(courseId),
	}).lean<RoutineRow[]>();
	return sortByWeekday(slots);
}

/**
 * Replace the course's whole weekly slot set.
 *
 * `PUT` rather than `PATCH` because a timetable is a bounded document: the
 * client always knows the complete set, so replacement is simpler than
 * per-slot add/remove and is idempotent without an idempotency key.
 *
 * Slots are reconciled by id rather than deleted and re-inserted: attendance is
 * filed under a slot id, so regenerating every id on each edit would orphan the
 * history of every class the student did not touch.
 */
export async function replaceRoutine(
	userId: string,
	courseId: string,
	slots: Array<{
		id?: string;
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

	const existing = await RoutineModel.find({ userId, courseId: objectId })
		.select("_id")
		.lean<Array<{ _id: Types.ObjectId }>>();
	const existingIds = new Set(existing.map((slot) => slot._id.toHexString()));

	const kept = slots.filter((slot) => slot.id !== undefined);
	for (const slot of kept) {
		if (!existingIds.has(slot.id as string)) {
			throw notFound("Routine slot not found for this course");
		}
	}
	const keptIds = new Set(kept.map((slot) => slot.id as string));

	await RoutineModel.deleteMany({
		userId,
		courseId: objectId,
		_id: { $nin: [...keptIds].map((id) => new Types.ObjectId(id)) },
	});

	await Promise.all(
		kept.map(({ id, ...fields }) =>
			RoutineModel.updateOne(
				{ _id: new Types.ObjectId(id), userId, courseId: objectId },
				{ $set: fields },
			),
		),
	);

	const fresh = slots.filter((slot) => slot.id === undefined);
	if (fresh.length > 0) {
		await RoutineModel.insertMany(
			fresh.map((slot) => ({ ...slot, userId, courseId: objectId })),
		);
	}

	return listRoutine(userId, courseId);
}

type RoutineRow = { dayOfWeek: string; startTime: string } & Record<string, unknown>;

/**
 * Weekday order, then start time. `dayOfWeek` is stored as a name, so a Mongo
 * sort on it would be alphabetical (FRIDAY before MONDAY).
 */
function sortByWeekday<T extends RoutineRow>(slots: T[]): T[] {
	const index = (day: string) => DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number]);
	return [...slots].sort(
		(a, b) =>
			index(a.dayOfWeek) - index(b.dayOfWeek) || a.startTime.localeCompare(b.startTime),
	);
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

	return scheduledClasses(userId, { dayOfWeek });
}

/**
 * Every weekly slot across all of the student's courses, each joined to its
 * course — the whole timetable in one read, in weekday order.
 */
export async function routineWeek(userId: string): Promise<ScheduledClass[]> {
	await connect();
	return scheduledClasses(userId, {});
}

async function scheduledClasses(
	userId: string,
	match: { dayOfWeek?: string },
): Promise<ScheduledClass[]> {
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
		{ $match: { userId, ...match } },
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
	]);

	return sortByWeekday(rows).map((row) => ({
		id: row._id,
		courseId: row.courseId,
		dayOfWeek: row.dayOfWeek,
		startTime: row.startTime,
		endTime: row.endTime,
		room: row.room,
		course: { id: row.courseId, title: row.title, code: row.code },
	})) as unknown as ScheduledClass[];
}
