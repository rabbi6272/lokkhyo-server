/**
 * Mongo models. One module per bounded context, each exporting its schema's
 * inferred document type alongside the model.
 *
 * Indexes are declared here rather than in a migration step: MongoDB has no
 * `migrate` command, so the schema *is* the migration. Mongoose builds missing
 * indexes on connect, which makes index creation idempotent.
 */

export {
	User,
	type UserDocument,
} from "@/models/user";
export {
	Semester,
	type SemesterDocument,
} from "@/models/semester";
export {
	Course,
	Routine,
	type CourseDocument,
	type RoutineDocument,
} from "@/models/course";
export {
	Attendance,
	type AttendanceDocument,
} from "@/models/attendance";
export {
	Assessment,
	type AssessmentDocument,
} from "@/models/assessment";
export {
	GpaRecord,
	Result,
	type GpaRecordDocument,
	type ResultDocument,
} from "@/models/result";
export {
	Deadline,
	type DeadlineDocument,
} from "@/models/deadline";
export {
	Device,
	Notification,
	NotificationPrefs,
	type DeviceDocument,
	type NotificationDocument,
	type NotificationPrefsDocument,
} from "@/models/notification";
