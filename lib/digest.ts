/**
 * Pure builders for server-sent notifications: no database, no clock, no I/O.
 * Everything time-dependent takes `now` explicitly so it is testable.
 *
 * The attendance thresholds mirror the app's `lib/attendance.ts`, so a push
 * never disagrees with the number the student sees on screen: a session is
 * "held" when it was PRESENT/LATE or ABSENT (EXCUSED and CANCELLED are not
 * counted), below 50% loses exam eligibility, and below 60% the attendance
 * mark drops to 0.
 */

export const FALLBACK_TIMEZONE = "Asia/Dhaka";

/** Below this, the student is not eligible to sit the exam. */
export const ELIGIBILITY_PERCENT = 50;
/** Below this, the attendance mark is 0 — the first warning line. */
export const WARNING_PERCENT = 60;
/** Too few sessions make a percentage noise; no alert below this many. */
export const MIN_HELD_SESSIONS = 3;

export interface LocalClock {
	/** `YYYY-MM-DD` in the student's timezone. */
	date: string;
	/** `HH:mm`, 24-hour, in the student's timezone. */
	time: string;
}

/** The wall clock in `timezone` at `now`. An unknown zone falls back to Dhaka. */
export function localClock(now: Date, timezone: string): LocalClock {
	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = clockFormat(timezone).formatToParts(now);
	} catch {
		parts = clockFormat(FALLBACK_TIMEZONE).formatToParts(now);
	}
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "00";
	return {
		date: `${get("year")}-${get("month")}-${get("day")}`,
		time: `${get("hour")}:${get("minute")}`,
	};
}

function clockFormat(timeZone: string) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
}

/** ISO week label of a `YYYY-MM-DD` date, e.g. `2026-W41`. */
export function isoWeek(date: string): string {
	const day = new Date(`${date}T00:00:00Z`);
	const weekday = day.getUTCDay() || 7;
	day.setUTCDate(day.getUTCDate() + 4 - weekday);
	const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
	const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
	return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type SessionMark = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "CANCELLED";

export interface DigestClass {
	slotId: string;
	courseId: string;
	code: string;
	startTime: string;
}

export interface PushText {
	title: string;
	body: string;
}

const MARK_LABEL: Record<SessionMark, string> = {
	PRESENT: "present",
	LATE: "late",
	ABSENT: "absent",
	EXCUSED: "excused",
	CANCELLED: "cancelled",
};

/** Key of a session's attendance record: slot-level, or the course-day record. */
export function sessionKey(courseId: string, slotId: string | null): string {
	return `${courseId}:${slotId ?? ""}`;
}

/**
 * The evening digest: today's classes with how each was marked.
 *
 * A class with no record is "not marked", never assumed absent. Returns null on
 * a day with no classes — there is nothing to remind about.
 */
export function buildAttendanceDigest(
	classes: DigestClass[],
	marks: Map<string, SessionMark>,
): (PushText & { unmarked: number }) | null {
	if (classes.length === 0) return null;

	let unmarked = 0;
	const lines = classes.map((cls) => {
		const mark = marks.get(sessionKey(cls.courseId, cls.slotId)) ?? marks.get(sessionKey(cls.courseId, null));
		if (!mark) unmarked += 1;
		return `${cls.code} ${cls.startTime} ${mark ? MARK_LABEL[mark] : "not marked"}`;
	});

	const title =
		unmarked > 0
			? `${unmarked} ${unmarked === 1 ? "class" : "classes"} not marked today`
			: "Today's attendance is all marked";
	return { title, body: lines.join(" · "), unmarked };
}

export interface AttendanceCounts {
	present: number;
	late: number;
	absent: number;
}

export interface AttendanceRisk {
	level: "BELOW_ELIGIBILITY" | "NO_ATTENDANCE_MARK";
	percent: number;
	held: number;
}

/** The course's risk level, or null when it is safe or too early to tell. */
export function attendanceRisk(counts: AttendanceCounts): AttendanceRisk | null {
	const attended = counts.present + counts.late;
	const held = attended + counts.absent;
	if (held < MIN_HELD_SESSIONS) return null;

	const percent = Math.round((attended / held) * 100);
	if (percent < ELIGIBILITY_PERCENT) return { level: "BELOW_ELIGIBILITY", percent, held };
	if (percent < WARNING_PERCENT) return { level: "NO_ATTENDANCE_MARK", percent, held };
	return null;
}

/** Consecutive classes the student must attend to climb back to `target`%. */
export function sessionsToRecover(counts: AttendanceCounts, target: number): number {
	const attended = counts.present + counts.late;
	const held = attended + counts.absent;
	// (attended + n) / (held + n) >= target/100  →  n >= (t·held − 100·attended) / (100 − t)
	return Math.max(0, Math.ceil((target * held - 100 * attended) / (100 - target)));
}

export function buildRiskAlert(code: string, counts: AttendanceCounts, risk: AttendanceRisk): PushText {
	if (risk.level === "BELOW_ELIGIBILITY") {
		const need = sessionsToRecover(counts, ELIGIBILITY_PERCENT);
		return {
			title: `${code}: attendance ${risk.percent}% — below exam eligibility`,
			body: `You need ${ELIGIBILITY_PERCENT}% to sit the exam. Attend the next ${need} ${
				need === 1 ? "class" : "classes"
			} to get back to it.`,
		};
	}
	const need = sessionsToRecover(counts, WARNING_PERCENT);
	return {
		title: `${code}: attendance ${risk.percent}%`,
		body: `Below ${WARNING_PERCENT}% your attendance mark is 0. Attend the next ${need} ${
			need === 1 ? "class" : "classes"
		} to recover it.`,
	};
}

/** Minutes since midnight of an `HH:mm` time. */
export function minutesOf(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

/**
 * Whether a send at `target` is due at local `time`: reached today, and — when
 * `windowMinutes` is given — not so long ago that it would be stale. A morning
 * greeting caught up at 21:00 is worse than none.
 */
export function isDue(time: string, target: string, windowMinutes?: number): boolean {
	const late = minutesOf(time) - minutesOf(target);
	return late >= 0 && (windowMinutes === undefined || late < windowMinutes);
}

/** How long after `morningRoutineTime` a missed morning push may still go out. */
export const MORNING_CATCH_UP_MINUTES = 180;

/** `14:05` → `2:05 PM`, `09:00` → `9 AM` — the format the app's routine uses. */
export function formatTime12h(time: string): string {
	const [hours, minutes] = time.split(":").map(Number);
	if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;
	const period = hours >= 12 ? "PM" : "AM";
	const hour = hours % 12 === 0 ? 12 : hours % 12;
	return minutes === 0 ? `${hour} ${period}` : `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

export interface MorningClass {
	code: string;
	startTime: string;
	room: string | null;
}

/**
 * The morning routine push: today's classes in start order, greeting the
 * student by first name. A day with no classes still gets a short note, as the
 * app's local version did.
 */
export function buildMorningRoutine(classes: MorningClass[], studentName?: string | null): PushText {
	const firstName = studentName?.trim().split(/\s+/)[0];
	const title = firstName ? `Good morning, ${firstName}! 🌅` : "Good morning! 🌅";
	const sorted = [...classes].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));

	if (sorted.length === 0) {
		return { title, body: "No classes scheduled today. Have a productive day! 🎯" };
	}
	if (sorted.length === 1) {
		const only = sorted[0];
		const room = only.room ? ` in Room ${only.room}` : "";
		return { title, body: `You have 1 class today. ${only.code} starts at ${formatTime12h(only.startTime)}${room}.` };
	}
	const list = sorted
		.map((cls) => `${cls.code} at ${formatTime12h(cls.startTime)}${cls.room ? ` (${cls.room})` : ""}`)
		.join(", ");
	return { title, body: `You have ${sorted.length} classes today: ${list}.` };
}
