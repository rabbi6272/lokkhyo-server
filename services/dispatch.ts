import { Types } from "mongoose";

import { connect } from "@/lib/db";
import {
	attendanceRisk,
	buildAttendanceDigest,
	buildDeadlineReminder,
	buildMorningRoutine,
	buildRiskAlert,
	FALLBACK_TIMEZONE,
	isDue,
	isLeadTimeDue,
	isoWeek,
	localClock,
	MORNING_CATCH_UP_MINUTES,
	sessionKey,
	type AttendanceCounts,
	type LocalClock,
	type SessionMark,
} from "@/lib/digest";
import { Attendance, Course, Device, SchedulerState, Semester, User } from "@/models";
import { routineForDate } from "@/services/course";
import { claimReminder, dueReminders } from "@/services/deadline";
import { processPendingPushReceipts, pruneStaleDevices } from "@/services/expoPush";
import { getNotificationPrefs } from "@/services/notification";
import { claimPush, sendPush } from "@/services/push";

const DUPLICATE_KEY = 11000;

/**
 * The scheduled dispatch: run every ~5 minutes by an external cron hitting
 * `/api/v1/internal/dispatch`.
 *
 * Each run walks every student with a registered device and sends whatever is
 * due in *their* timezone:
 *
 * - the morning routine, at `morningRoutineTime` — today's classes, built from
 *   the timetable as it stands that morning;
 * - the evening attendance digest, at `eveningAttendanceTime`;
 * - attendance-risk alerts, checked at the same time, at most once a week per
 *   course and risk level;
 * - upcoming deadline and assessment reminders, sent when a configured reminder
 *   lead time window has opened.
 *
 * "Due" means the local time has reached the configured time *today*, not that
 * it equals it, so a missed cron run catches up later — within three hours for
 * the morning push, any time that evening for the evening ones. A claim per
 * `(user, key)` or per-deadline lead time makes every send exactly-once.
 */

export interface DispatchReport {
	usersChecked: number;
	sent: number;
	failures: number;
	skipped?: boolean;
}

interface Prefs {
	timezone: string;
	morningRoutineTime: string;
	eveningAttendanceTime: string;
	categoriesEnabled: {
		ROUTINE?: boolean;
		ATTENDANCE?: boolean;
		ATTENDANCE_RISK?: boolean;
		DEADLINE?: boolean;
	};
}

export async function runDispatch(
	now: Date = new Date(),
	options?: { bypassLock?: boolean },
): Promise<DispatchReport> {
	await connect();

	if (!options?.bypassLock) {
		const lock = await SchedulerState.findOneAndUpdate(
			{
				_id: "dispatch",
				lockedUntil: { $lte: now },
			},
			{
				$set: {
					lastRunAt: now,
					lockedUntil: new Date(now.getTime() + 5 * 60 * 1000),
				},
			},
			{ upsert: true, returnDocument: "after" },
		).catch((error: { code?: number }) => {
			// Lock held: the filter misses, so the upsert collides with the existing `_id`.
			if (error.code === DUPLICATE_KEY) return null;
			throw error;
		});

		if (!lock) {
			console.log("[dispatch] lock busy; skipping overlapping dispatch run");
			return { usersChecked: 0, sent: 0, failures: 0, skipped: true };
		}
	}

	try {
		// Process Expo push receipts from earlier runs (older than 15 min) and prune dead tokens
		await processPendingPushReceipts().catch((error) => {
			console.error("[dispatch] processPendingPushReceipts failed:", error);
		});

		// Periodically prune devices inactive for over 90 days
		await pruneStaleDevices(90).catch((error) => {
			console.error("[dispatch] pruneStaleDevices failed:", error);
		});

		// Find all students with any registered device (Android or iOS)
		const userIds: string[] = await Device.distinct("userId");

		const report: DispatchReport = { usersChecked: userIds.length, sent: 0, failures: 0 };
		for (const userId of userIds) {
			try {
				report.sent += await dispatchForUser(userId, now);
			} catch (error) {
				// One student's bad data must not stop everyone else's notifications.
				report.failures += 1;
				console.error(`[dispatch] user ${userId} failed:`, error);
			}
		}

		if (!options?.bypassLock) {
			await SchedulerState.updateOne(
				{ _id: "dispatch" },
				{
					$set: {
						lastSuccessAt: now,
						lockedUntil: new Date(0),
					},
				},
			);
		}

		return report;
	} catch (err) {
		if (!options?.bypassLock) {
			await SchedulerState.updateOne(
				{ _id: "dispatch" },
				{ $set: { lockedUntil: new Date(0) } },
			).catch(() => {});
		}
		throw err;
	}
}

async function dispatchForUser(userId: string, now: Date): Promise<number> {
	const prefs = (await getNotificationPrefs(userId)) as unknown as Prefs;
	const timezone = prefs.timezone || FALLBACK_TIMEZONE;
	const clock = localClock(now, timezone);

	let sent = 0;
	if (
		prefs.categoriesEnabled.ROUTINE !== false &&
		isDue(clock.time, prefs.morningRoutineTime, MORNING_CATCH_UP_MINUTES)
	) {
		sent += await morningRoutine(userId, timezone, clock);
	}

	if (isDue(clock.time, prefs.eveningAttendanceTime)) {
		if (prefs.categoriesEnabled.ATTENDANCE !== false) {
			sent += await eveningDigest(userId, timezone, clock);
		}
		if (prefs.categoriesEnabled.ATTENDANCE_RISK !== false) {
			sent += await riskAlerts(userId, clock);
		}
	}

	if (prefs.categoriesEnabled.DEADLINE !== false) {
		sent += await deadlineReminders(userId, timezone, now);
	}
	return sent;
}

async function morningRoutine(userId: string, timezone: string, clock: LocalClock): Promise<number> {
	if (!(await claimPush(userId, `morning-routine:${clock.date}`))) return 0;

	const [classes, user] = await Promise.all([
		routineForDate(userId, timezone, clock.date),
		User.findOne({ firebaseUid: userId }).select("name").lean<{ name: string | null }>(),
	]);
	const text = buildMorningRoutine(
		classes.map((cls) => ({ code: cls.course.code, startTime: cls.startTime, room: cls.room })),
		user?.name,
	);

	await sendPush(userId, { category: "ROUTINE", title: text.title, body: text.body, link: "/routine" });
	return 1;
}

async function eveningDigest(userId: string, timezone: string, clock: LocalClock): Promise<number> {
	const classes = await routineForDate(userId, timezone, clock.date);
	const records = await Attendance.find({ userId, date: clock.date })
		.select("courseId slotId status")
		.lean<Array<{ courseId: Types.ObjectId; slotId: string | null; status: SessionMark }>>();

	const marks = new Map(records.map((r) => [sessionKey(String(r.courseId), r.slotId), r.status]));
	const digest = buildAttendanceDigest(
		classes.map((cls) => ({
			slotId: String(cls.id),
			courseId: String(cls.courseId),
			code: cls.course.code,
			startTime: cls.startTime,
		})),
		marks,
	);
	if (!digest) return 0;
	if (!(await claimPush(userId, `attendance-digest:${clock.date}`))) return 0;

	await sendPush(userId, {
		category: "ATTENDANCE",
		title: digest.title,
		body: digest.body,
		link: "/(tabs)/attendance",
	});
	return 1;
}

/** Courses of the active term(s) — an archived semester's attendance is final. */
async function activeCourses(userId: string) {
	const semesters = await Semester.find({ userId, status: { $ne: "ARCHIVED" } })
		.select("_id")
		.lean<Array<{ _id: Types.ObjectId }>>();
	if (semesters.length === 0) return [];
	return Course.find({ userId, semesterId: { $in: semesters.map((s) => s._id) } })
		.select("_id code")
		.lean<Array<{ _id: Types.ObjectId; code: string }>>();
}

async function riskAlerts(userId: string, clock: LocalClock): Promise<number> {
	const courses = await activeCourses(userId);
	if (courses.length === 0) return 0;

	const rows = await Attendance.aggregate<{ _id: { courseId: Types.ObjectId; status: SessionMark }; count: number }>([
		{ $match: { userId, courseId: { $in: courses.map((c) => c._id) }, date: { $lte: clock.date } } },
		{ $group: { _id: { courseId: "$courseId", status: "$status" }, count: { $sum: 1 } } },
	]);

	const counts = new Map<string, AttendanceCounts>();
	for (const row of rows) {
		const key = String(row._id.courseId);
		const entry = counts.get(key) ?? { present: 0, late: 0, absent: 0 };
		if (row._id.status === "PRESENT") entry.present += row.count;
		if (row._id.status === "LATE") entry.late += row.count;
		if (row._id.status === "ABSENT") entry.absent += row.count;
		counts.set(key, entry);
	}

	const week = isoWeek(clock.date);
	let sent = 0;
	for (const course of courses) {
		const courseCounts = counts.get(String(course._id));
		if (!courseCounts) continue;
		const risk = attendanceRisk(courseCounts);
		if (!risk) continue;
		if (!(await claimPush(userId, `attendance-risk:${String(course._id)}:${risk.level}:${week}`))) continue;

		const alert = buildRiskAlert(course.code, courseCounts, risk);
		await sendPush(userId, {
			category: "ATTENDANCE_RISK",
			title: alert.title,
			body: alert.body,
			link: `/course/${String(course._id)}`,
		});
		sent += 1;
	}
	return sent;
}

export async function deadlineReminders(
	userId: string,
	timezone: string,
	now: Date,
): Promise<number> {
	const deadlines = await dueReminders(userId, now);
	if (deadlines.length === 0) return 0;

	const courseIds = deadlines
		.map((d) => d.courseId)
		.filter((id): id is Types.ObjectId => id !== null);

	const courses =
		courseIds.length > 0
			? await Course.find({ _id: { $in: courseIds } })
					.select("_id code")
					.lean<Array<{ _id: Types.ObjectId; code: string }>>()
			: [];
	const courseCodeMap = new Map(courses.map((c) => [String(c._id), c.code]));

	let sent = 0;
	for (const deadline of deadlines) {
		for (const leadTimeHours of deadline.reminderLeadTimes) {
			if (!isLeadTimeDue(deadline.dueAt, leadTimeHours, deadline.remindersSent ?? [], now)) {
				continue;
			}

			// Atomic conditional update ensures exactly-once send across concurrent runs
			const claimed = await claimReminder(userId, String(deadline._id), leadTimeHours);
			if (!claimed) continue;

			const courseCode = deadline.courseId
				? courseCodeMap.get(String(deadline.courseId))
				: null;

			const text = buildDeadlineReminder(
				{
					title: deadline.title,
					type: deadline.type,
					assessmentType: deadline.assessmentType,
					dueAt: deadline.dueAt,
					courseCode,
					leadTimeHours,
				},
				now,
				timezone,
			);

			await sendPush(userId, {
				category: "DEADLINE",
				title: text.title,
				body: text.body,
				link: deadline.courseId ? `/course/${String(deadline.courseId)}` : null,
			});
			sent += 1;
		}
	}
	return sent;
}
