import { z } from "zod";

/**
 * Primitives and enums shared by every endpoint.
 *
 * This file is the bottom of the contract. Everything else is built from it, so
 * a change here is a change to the whole API — which is why the enums live
 * here rather than next to whichever module first needed them.
 */

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * A branded ObjectId. The transform means a schema can be fed a Mongoose
 * document directly — `String(new Types.ObjectId(...))` is the hex form — so
 * output schemas parse a model without an intermediate mapping step.
 *
 * The brand is the point: it makes `CourseId` unassignable to `SemesterId`, so
 * a swapped argument is a compile error rather than a query against the wrong
 * collection.
 */
const brandedId = <Brand extends string>() =>
	z
		.unknown()
		.transform((value) => (value === null || value === undefined ? value : String(value)))
		.pipe(z.string().regex(OBJECT_ID, "Must be a 24-character hex ObjectId"))
		.brand<Brand>();

export const UserIdSchema = brandedId<"UserId">();
export type UserId = z.infer<typeof UserIdSchema>;

/**
 * The owner of a record: the Firebase uid, which is what every `userId` column
 * stores. Not an ObjectId — Firebase uids are 28 alphanumeric characters — so
 * it must not be validated as one, or every response carrying it would fail
 * its own contract.
 */
export const OwnerUidSchema = z.string().min(1).max(128).brand<"OwnerUid">();
export type OwnerUid = z.infer<typeof OwnerUidSchema>;

export const SemesterIdSchema = brandedId<"SemesterId">();
export type SemesterId = z.infer<typeof SemesterIdSchema>;

export const CourseIdSchema = brandedId<"CourseId">();
export type CourseId = z.infer<typeof CourseIdSchema>;

export const RoutineIdSchema = brandedId<"RoutineId">();
export type RoutineId = z.infer<typeof RoutineIdSchema>;

export const AttendanceIdSchema = brandedId<"AttendanceId">();
export type AttendanceId = z.infer<typeof AttendanceIdSchema>;

export const AssessmentIdSchema = brandedId<"AssessmentId">();
export type AssessmentId = z.infer<typeof AssessmentIdSchema>;

export const ResultIdSchema = brandedId<"ResultId">();
export type ResultId = z.infer<typeof ResultIdSchema>;

export const DeadlineIdSchema = brandedId<"DeadlineId">();
export type DeadlineId = z.infer<typeof DeadlineIdSchema>;

export const DeviceIdSchema = brandedId<"DeviceId">();
export type DeviceId = z.infer<typeof DeviceIdSchema>;

export const NotificationIdSchema = brandedId<"NotificationId">();
export type NotificationId = z.infer<typeof NotificationIdSchema>;

/**
 * A UTC instant, normalised to ISO-8601 on the wire.
 *
 * Accepts a `Date` so output schemas can be applied straight to a Mongoose
 * document. Every timestamp in this API is UTC; local time is a presentation
 * concern and never appears on the wire.
 */
export const isoDateTime = z
	.unknown()
	.transform((value) => (value instanceof Date ? value.toISOString() : value))
	.pipe(z.iso.datetime());

/** A calendar date with no time component, `YYYY-MM-DD`. */
export const calendarDate = z.iso.date();

/**
 * A wall-clock time of day, `HH:mm`.
 *
 * Deliberately *not* a datetime. A class meeting at 09:00 means 09:00 in the
 * student's own timezone on whichever date it falls, so encoding it as an
 * instant would silently shift the timetable by the UTC offset.
 */
export const wallClockTime = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a 24-hour HH:mm time");

export const dayOfWeek = z.enum([
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
]);
export type DayOfWeek = z.infer<typeof dayOfWeek>;

export const attendanceStatus = z.enum([
	"PRESENT",
	"ABSENT",
	"LATE",
	"EXCUSED",
	/** The class did not happen; excluded from every count. */
	"CANCELLED",
]);
export type AttendanceStatus = z.infer<typeof attendanceStatus>;

export const assessmentType = z.enum([
	"CT",
	"ASSIGNMENT",
	"QUIZ",
	"MIDTERM",
	"FINAL",
	"LAB",
	"PROJECT",
	"OTHER",
]);
export type AssessmentType = z.infer<typeof assessmentType>;

export const letterGrade = z.enum([
	"A+",
	"A",
	"A-",
	"B+",
	"B",
	"B-",
	"C+",
	"C",
	"C-",
	"D",
	"F",
	"I",
]);
export type LetterGrade = z.infer<typeof letterGrade>;

export const resultStatus = z.enum(["PASSED", "BACKLOG", "INCOMPLETE"]);
export type ResultStatus = z.infer<typeof resultStatus>;

export const deadlineType = z.enum([
	"ASSESSMENT",
	"REGISTRATION",
	"WITHDRAWAL",
	"EXAM",
	"OTHER",
]);
export type DeadlineType = z.infer<typeof deadlineType>;

export const platform = z.enum(["ANDROID", "IOS"]);
export type Platform = z.infer<typeof platform>;

export const userRole = z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]);
export type UserRole = z.infer<typeof userRole>;

export const notificationCategory = z.enum([
	"ROUTINE",
	"ATTENDANCE",
	"ATTENDANCE_RISK",
	"DEADLINE",
	"GRADE",
]);
export type NotificationCategory = z.infer<typeof notificationCategory>;

export const classification = z.enum([
	"FIRST_CLASS_WITH_HONORS",
	"FIRST_CLASS",
	"SECOND_CLASS",
	"FAIL",
	"IN_PROGRESS",
]);
export type Classification = z.infer<typeof classification>;

/** Credits in 0.25 steps: RUET labs are 0.75 and 1.5, theory courses usually 2–4. */
export const credits = z.coerce
	.number()
	.min(0.5)
	.max(12)
	.multipleOf(0.25, "Credits must be a multiple of 0.25");

/** Percentage points, used for attendance and any similar bounded value. */
export const percentage = z.coerce.number().min(0).max(100);

export const pageResponse = <T extends z.ZodType>(item: T) =>
	z.object({
		data: z.array(item),
		pagination: z.object({
			nextCursor: z.string().nullable(),
			hasMore: z.boolean(),
			limit: z.number().int().positive(),
		}),
	});

/** `?cascade=true` on a destructive parent route. */
export const cascadeQuery = z.object({
	cascade: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default(false),
});

export type CascadeQuery = z.infer<typeof cascadeQuery>;

/** `[object Object]`-shaped free-form data, as Zod's issue list produces. */
export const validationDetails = z.object({
	fields: z.array(
		z.object({
			path: z.string(),
			code: z.string(),
			message: z.string(),
		}),
	),
});
