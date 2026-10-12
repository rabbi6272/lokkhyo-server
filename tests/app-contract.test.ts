import { describe, expect, it } from "vitest";

import { assessmentSchema, createAssessmentInput, updateAssessmentInput } from "@/schemas/assessment";
import { attendanceSchema, putAttendanceInput } from "@/schemas/attendance";
import { courseSchema, createCourseInput } from "@/schemas/course";
import { replaceRoutineInput } from "@/schemas/course";
import { cgpaSchema } from "@/schemas/grade";
import {
	createSemesterInput,
	endDateFromWeeks,
	semesterSchema,
	updateSemesterInput,
} from "@/schemas/semester";

/**
 * Contract tests for the fields added so the Expo app can move off Firestore.
 *
 * Every added response field has a default, so a document written before the
 * field existed still parses — otherwise `respond()` would 500 for every
 * student with older data.
 */
const OID = "65f1c0ffee0000000000abcd";
const NOW = new Date("2026-10-11T00:00:00Z");

describe("semester", () => {
	it("derives the last day of a term from its week count", () => {
		expect(endDateFromWeeks("2026-01-03", 1)).toBe("2026-01-09");
		expect(endDateFromWeeks("2026-01-03", 13)).toBe("2026-04-03");
	});

	it("accepts totalWeeks in place of endDate, but not neither", () => {
		expect(() =>
			createSemesterInput.parse({ name: "S1", startDate: "2026-01-03", totalWeeks: 13 }),
		).not.toThrow();
		expect(() => createSemesterInput.parse({ name: "S1", startDate: "2026-01-03" })).toThrow();
	});

	it("validates status and targetGpa on update", () => {
		expect(updateSemesterInput.parse({ status: "ARCHIVED", targetGpa: 3.5 })).toEqual({
			status: "ARCHIVED",
			targetGpa: 3.5,
		});
		expect(() => updateSemesterInput.parse({ status: "inactive" })).toThrow();
		expect(() => updateSemesterInput.parse({ targetGpa: 4.5 })).toThrow();
	});

	it("parses a semester stored before the new fields existed", () => {
		const legacy = semesterSchema.parse({
			id: OID,
			userId: "Xk2fQ9aB7cD1eF3gH5iJ7kL9mN0p",
			name: "S1",
			startDate: "2026-01-03",
			endDate: "2026-04-03",
			createdAt: NOW,
			updatedAt: NOW,
		});
		expect(legacy).toMatchObject({ status: "ACTIVE", targetGpa: null, totalWeeks: null });
	});
});

describe("course", () => {
	it("accepts the CT-progress settings", () => {
		const input = createCourseInput.parse({
			semesterId: OID,
			title: "Algorithms",
			code: "CSE 2101",
			passMarks: 40,
			ctWeight: 20,
			isLab: false,
			courseTeachers: ["Dr. Rahman"],
		});
		expect(input.courseTeachers).toEqual(["Dr. Rahman"]);
	});

	it("defaults them on an older document", () => {
		const legacy = courseSchema.parse({
			id: OID,
			userId: "Xk2fQ9aB7cD1eF3gH5iJ7kL9mN0p",
			semesterId: OID,
			title: "Algorithms",
			code: "CSE 2101",
			instructor: null,
			credits: 3,
			createdAt: NOW,
			updatedAt: NOW,
		});
		expect(legacy).toMatchObject({ passMarks: null, ctWeight: null, isLab: false, courseTeachers: [] });
	});
});

describe("assessment", () => {
	const base = { courseId: OID, type: "CT", title: "CT 1", date: "2026-10-11", maxMarks: 20 };

	it("accepts a CT with a recorded mark", () => {
		expect(createAssessmentInput.parse({ ...base, marksObtained: 18, weight: 5 })).toMatchObject({
			type: "CT",
			marksObtained: 18,
		});
	});

	it("rejects a mark above the ceiling", () => {
		expect(() => createAssessmentInput.parse({ ...base, marksObtained: 21 })).toThrow();
		expect(() => updateAssessmentInput.parse({ marksObtained: 30, maxMarks: 20 })).toThrow();
	});

	it("defaults the new fields on an older document", () => {
		const legacy = assessmentSchema.parse({
			id: OID,
			courseId: OID,
			type: "QUIZ",
			title: "Quiz",
			date: "2026-10-11",
			maxMarks: 10,
			createdAt: NOW,
			updatedAt: NOW,
		});
		expect(legacy).toMatchObject({ marksObtained: null, weight: null, teacherName: null });
	});
});

describe("attendance", () => {
	it("keys a session on its slot and accepts CANCELLED", () => {
		expect(
			putAttendanceInput.parse({ date: "2026-10-11", slotId: OID, status: "CANCELLED" }),
		).toEqual({ date: "2026-10-11", slotId: OID, status: "CANCELLED" });
	});

	it("rejects a slot id that is not an ObjectId", () => {
		expect(() =>
			putAttendanceInput.parse({ date: "2026-10-11", slotId: "slot-1", status: "PRESENT" }),
		).toThrow();
	});

	it("parses a record stored before slotId existed", () => {
		const legacy = attendanceSchema.parse({
			id: OID,
			courseId: OID,
			date: "2026-10-11",
			status: "PRESENT",
			note: null,
			createdAt: NOW,
			updatedAt: NOW,
		});
		expect(legacy.slotId).toBeNull();
	});
});

describe("routine", () => {
	it("lets a slot carry its id so it survives a replace", () => {
		const input = replaceRoutineInput.parse({
			slots: [
				{ id: OID, dayOfWeek: "SATURDAY", startTime: "09:00", endTime: "10:00" },
				{ dayOfWeek: "SUNDAY", startTime: "11:00", endTime: "12:00", room: "402" },
			],
		});
		expect(input.slots[0].id).toBe(OID);
		expect(input.slots[1].room).toBe("402");
	});

	it("still rejects an inverted slot", () => {
		expect(() =>
			replaceRoutineInput.parse({
				slots: [{ dayOfWeek: "SUNDAY", startTime: "12:00", endTime: "11:00" }],
			}),
		).toThrow();
	});
});

describe("cgpa", () => {
	it("is CGPA-shaped, not degree-status-shaped", () => {
		expect(
			cgpaSchema.parse({
				cgpa: 3.42,
				totalCredits: 18,
				totalWeightedPoints: 61.56,
				coursesCounted: 6,
			}),
		).toEqual({
			cgpa: 3.42,
			totalCredits: 18,
			totalWeightedPoints: 61.56,
			coursesCounted: 6,
		});
		expect(() =>
			cgpaSchema.parse({ cgpa: 3.42, classification: "FIRST_CLASS" }),
		).toThrow();
	});

	it("serves the unrounded numerator so a client need not rebuild it", () => {
		// `cgpa` is rounded to 2dp; the numerator is what a projection needs to
		// stay exact. If it were missing, `cgpa * totalCredits` would be off by
		// up to `0.005 * totalCredits`.
		const parsed = cgpaSchema.parse({
			cgpa: 2.94,
			totalCredits: 12,
			totalWeightedPoints: 35.25,
			coursesCounted: 5,
		});
		// The two must be consistent: numerator / credits rounds back to cgpa.
		expect(Math.round((parsed.totalWeightedPoints / parsed.totalCredits) * 100) / 100).toBe(
			parsed.cgpa,
		);
	});
});
