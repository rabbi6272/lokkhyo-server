import { describe, expect, it } from "vitest";

import {
	attendanceRisk,
	buildAttendanceDigest,
	buildDeadlineReminder,
	buildMorningRoutine,
	buildRiskAlert,
	formatFriendlyDate,
	formatTime12h,
	isDue,
	isLeadTimeDue,
	isoWeek,
	localClock,
	MORNING_CATCH_UP_MINUTES,
	sessionKey,
	sessionsToRecover,
	type SessionMark,
} from "@/lib/digest";

describe("localClock", () => {
	it("reads the wall clock in the student's timezone, not UTC", () => {
		// 18:30 UTC is 00:30 the next day in Dhaka (UTC+6).
		expect(localClock(new Date("2026-10-11T18:30:00Z"), "Asia/Dhaka")).toEqual({
			date: "2026-10-12",
			time: "00:30",
		});
	});

	it("falls back to Dhaka for an unknown zone", () => {
		expect(localClock(new Date("2026-10-11T14:00:00Z"), "Mars/Olympus")).toEqual({
			date: "2026-10-11",
			time: "20:00",
		});
	});
});

describe("isoWeek", () => {
	it("labels ISO weeks, including the year boundary", () => {
		expect(isoWeek("2026-10-11")).toBe("2026-W41");
		expect(isoWeek("2027-01-01")).toBe("2026-W53");
	});
});

describe("buildAttendanceDigest", () => {
	const classes = [
		{ slotId: "s1", courseId: "c1", code: "CSE 3105", startTime: "09:00" },
		{ slotId: "s2", courseId: "c2", code: "CSE 3107", startTime: "11:00" },
	];

	it("returns null on a day with no classes", () => {
		expect(buildAttendanceDigest([], new Map())).toBeNull();
	});

	it("reports unmarked classes as not marked, never absent", () => {
		const marks = new Map<string, SessionMark>([[sessionKey("c1", "s1"), "PRESENT"]]);
		const digest = buildAttendanceDigest(classes, marks);
		expect(digest).toEqual({
			title: "1 class not marked today",
			body: "CSE 3105 09:00 present · CSE 3107 11:00 not marked",
			unmarked: 1,
		});
	});

	it("accepts a course-day record for a slot", () => {
		const marks = new Map<string, SessionMark>([
			[sessionKey("c1", null), "ABSENT"],
			[sessionKey("c2", "s2"), "CANCELLED"],
		]);
		expect(buildAttendanceDigest(classes, marks)?.title).toBe("Today's attendance is all marked");
	});
});

describe("attendanceRisk", () => {
	it("stays quiet until enough sessions are held", () => {
		expect(attendanceRisk({ present: 0, late: 0, absent: 2 })).toBeNull();
	});

	it("flags below eligibility under 50%", () => {
		expect(attendanceRisk({ present: 2, late: 0, absent: 3 })).toEqual({
			level: "BELOW_ELIGIBILITY",
			percent: 40,
			held: 5,
		});
	});

	it("warns under 60%, counting LATE as attended", () => {
		expect(attendanceRisk({ present: 4, late: 1, absent: 4 })?.level).toBe("NO_ATTENDANCE_MARK");
		expect(attendanceRisk({ present: 6, late: 0, absent: 4 })).toBeNull();
	});
});

describe("sessionsToRecover", () => {
	it("counts the consecutive classes needed to reach the target", () => {
		// 2/5 = 40%; attending 1 more gives 3/6 = 50%.
		expect(sessionsToRecover({ present: 2, late: 0, absent: 3 }, 50)).toBe(1);
		// 5/10 = 50%; need (60·10 − 500)/40 = 2.5 → 3 more for 8/13 ≈ 61.5%.
		expect(sessionsToRecover({ present: 5, late: 0, absent: 5 }, 60)).toBe(3);
		expect(sessionsToRecover({ present: 9, late: 0, absent: 1 }, 60)).toBe(0);
	});

	it("puts the count in the alert", () => {
		const counts = { present: 2, late: 0, absent: 3 };
		const risk = attendanceRisk(counts);
		expect(risk && buildRiskAlert("CSE 3105", counts, risk)).toEqual({
			title: "CSE 3105: attendance 40% — below exam eligibility",
			body: "You need 50% to sit the exam. Attend the next 1 class to get back to it.",
		});
	});
});

describe("morning routine", () => {
	it("is due from the set time, within the catch-up window only", () => {
		expect(isDue("06:59", "07:00", MORNING_CATCH_UP_MINUTES)).toBe(false);
		expect(isDue("07:00", "07:00", MORNING_CATCH_UP_MINUTES)).toBe(true);
		expect(isDue("09:59", "07:00", MORNING_CATCH_UP_MINUTES)).toBe(true);
		expect(isDue("10:00", "07:00", MORNING_CATCH_UP_MINUTES)).toBe(false);
		// No window: due for the rest of the day.
		expect(isDue("23:50", "20:00")).toBe(true);
	});

	it("formats times like the app", () => {
		expect(formatTime12h("09:00")).toBe("9 AM");
		expect(formatTime12h("14:05")).toBe("2:05 PM");
		expect(formatTime12h("00:30")).toBe("12:30 AM");
	});

	it("greets by first name and lists classes in start order", () => {
		expect(
			buildMorningRoutine(
				[
					{ code: "CSE 3107", startTime: "11:00", room: null },
					{ code: "CSE 3105", startTime: "09:00", room: "402" },
				],
				"Ayesha Rahman",
			),
		).toEqual({
			title: "Good morning, Ayesha! 🌅",
			body: "You have 2 classes today: CSE 3105 at 9 AM (402), CSE 3107 at 11 AM.",
		});
	});

	it("still says something on a free day", () => {
		expect(buildMorningRoutine([], null)).toEqual({
			title: "Good morning! 🌅",
			body: "No classes scheduled today. Have a productive day! 🎯",
		});
	});

	it("names the room for a single class", () => {
		expect(buildMorningRoutine([{ code: "CSE 3105", startTime: "09:00", room: "402" }]).body).toBe(
			"You have 1 class today. CSE 3105 starts at 9 AM in Room 402.",
		);
	});
});

describe("isLeadTimeDue", () => {
	const dueAt = new Date("2026-10-25T12:00:00Z");
	const lead72h = 72;
	const lead24h = 24;

	it("returns false before the trigger window opens", () => {
		// 72h before dueAt is 2026-10-22T12:00:00Z. At 11:59:59Z, it is not due yet.
		const before72 = new Date("2026-10-22T11:59:59Z");
		expect(isLeadTimeDue(dueAt, lead72h, [], before72)).toBe(false);
	});

	it("returns true at or after the trigger time if not already sent", () => {
		const at72 = new Date("2026-10-22T12:00:00Z");
		expect(isLeadTimeDue(dueAt, lead72h, [], at72)).toBe(true);

		const after72 = new Date("2026-10-22T12:05:00Z");
		expect(isLeadTimeDue(dueAt, lead72h, [], after72)).toBe(true);
	});

	it("returns false if this lead time was already sent", () => {
		const after72 = new Date("2026-10-22T12:05:00Z");
		expect(isLeadTimeDue(dueAt, lead72h, [{ leadTimeHours: 72 }], after72)).toBe(false);
		// But a different lead time (24h) is still evaluated
		expect(isLeadTimeDue(dueAt, lead24h, [{ leadTimeHours: 72 }], after72)).toBe(false); // not due yet
	});

	it("returns false if the deadline has already passed", () => {
		const pastDue = new Date("2026-10-25T12:00:01Z");
		expect(isLeadTimeDue(dueAt, lead24h, [], pastDue)).toBe(false);
	});
});

describe("buildDeadlineReminder", () => {
	it("formats multi-day reminders with course code and relative distance", () => {
		const now = new Date("2026-10-22T10:00:00Z");
		const dueAt = new Date("2026-10-25T10:00:00Z"); // 3 days away
		const reminder = buildDeadlineReminder(
			{
				title: "CT 2 - Algorithm Design",
				type: "ASSESSMENT",
				assessmentType: "CT",
				dueAt,
				courseCode: "CSE 3105",
				leadTimeHours: 72,
			},
			now,
			"Asia/Dhaka",
		);

		expect(reminder.title).toBe("CSE 3105 · CT 2 - Algorithm Design ⏰");
		expect(reminder.body).toContain("Due in 3 days");
		expect(reminder.body).toContain("Tap to view details.");
	});

	it("formats near-due reminders with 'tomorrow' or hours", () => {
		const now = new Date("2026-10-24T10:00:00Z");
		const dueAt = new Date("2026-10-25T10:00:00Z"); // 24 hours away
		const reminder = buildDeadlineReminder(
			{
				title: "Final Report",
				type: "ASSESSMENT",
				assessmentType: "PROJECT",
				dueAt,
				courseCode: "CSE 3107",
				leadTimeHours: 24,
			},
			now,
			"Asia/Dhaka",
		);

		expect(reminder.title).toBe("CSE 3107 · Final Report ⏰");
		expect(reminder.body).toContain("Due tomorrow");
	});

	it("handles standalone reminders without course code", () => {
		const now = new Date("2026-10-22T10:00:00Z");
		const dueAt = new Date("2026-10-25T10:00:00Z");
		const reminder = buildDeadlineReminder(
			{
				title: "Semester Fee Payment",
				type: "REGISTRATION",
				assessmentType: null,
				dueAt,
				courseCode: null,
				leadTimeHours: 72,
			},
			now,
			"Asia/Dhaka",
		);

		expect(reminder.title).toBe("Semester Fee Payment ⏰");
		expect(reminder.body).toContain("Due in 3 days");
	});
});
