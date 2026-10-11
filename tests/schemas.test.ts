import { describe, expect, it } from "vitest";

import {
	amendAttendanceInput,
	attendanceIdParams,
	listAttendanceQuery,
	putAttendanceInput,
} from "@/schemas/attendance";
import { listAssessmentsQuery } from "@/schemas/assessment";
import { cascadeQuery } from "@/schemas/common";
import { MAX_LIMIT, limitQuery } from "@/lib/pagination";
import { createSemesterInput, updateSemesterInput } from "@/schemas/semester";
import { createResultInput, updateResultInput } from "@/schemas/result";
import { replaceRoutineInput } from "@/schemas/course";
import { updateMeInput, userSchema } from "@/schemas/user";

/**
 * Contract tests for the Zod layer.
 *
 * These assert the behaviour the routes depend on, in particular the
 * defaulting and coercion rules, which are where a schema is most likely to
 * disagree with the code that reads it.
 */
describe("query defaults", () => {
	it("applies the upcoming default without tripping the transform", () => {
		// `.default()` runs before `.transform()` in the pipeline, so a schema
		// that defaults to a post-transform value would reject an absent key.
		expect(listAssessmentsQuery.parse({})).toEqual({ upcoming: false });
		expect(listAssessmentsQuery.parse({ upcoming: "true" })).toEqual({ upcoming: true });
		expect(listAssessmentsQuery.parse({ upcoming: "false" })).toEqual({
			upcoming: false,
		});
	});

	it("defaults the page size and rejects a nonsense one", () => {
		expect(limitQuery.parse({})).toEqual({ limit: 20 });
		expect(limitQuery.parse({ limit: "50" })).toEqual({ limit: 50 });
		// Above MAX_LIMIT: rejected rather than silently clamped, so a client
		// asking for more than the cap learns it did not get that many rows.
		expect(() => limitQuery.parse({ limit: String(MAX_LIMIT + 1) })).toThrow();
		expect(() => limitQuery.parse({ limit: "0" })).toThrow();
	});

	it("defaults cascade to false", () => {
		expect(cascadeQuery.parse({})).toEqual({ cascade: false });
		expect(cascadeQuery.parse({ cascade: "true" })).toEqual({ cascade: true });
	});

	it("leaves an absent attendance filter undefined", () => {
		expect(listAttendanceQuery.parse({})).toEqual({});
		expect(
			listAttendanceQuery.parse({ from: "2026-01-01", to: "2026-01-31" }),
		).toEqual({ from: "2026-01-01", to: "2026-01-31" });
	});
});

describe("id params", () => {
	it("accepts a 24-character hex ObjectId", () => {
		const id = "65f0c1a2b3c4d5e6f7a8b9c0";
		expect(attendanceIdParams.parse({ id }).id).toBe(id);
	});

	it("rejects a short, non-ObjectId path segment", () => {
		// Guards against the id being something the client invented.
		expect(() => attendanceIdParams.parse({ id: "abc" })).toThrow();
		expect(() => attendanceIdParams.parse({})).toThrow();
	});
});

describe("strictObject", () => {
	it("rejects unknown keys so a typo is not silently ignored", () => {
		expect(() =>
			amendAttendanceInput.parse({ status: "PRESENT", statues: true }),
		).toThrow();
	});

	it("rejects an out-of-range status", () => {
		const body = { date: "2026-01-15", status: "ABSENT" };
		expect(() => putAttendanceInput.parse(body)).not.toThrow();
		expect(() => putAttendanceInput.parse({ ...body, status: "absent" })).toThrow();
		expect(() => putAttendanceInput.parse({ ...body, status: "TARDY" })).toThrow();
	});

	it("does not accept a courseId in the body, only in the path", () => {
		// The path already carries it; a second copy in the body could disagree
		// with it, and the server would have to pick a winner.
		expect(() =>
			putAttendanceInput.parse({
				date: "2026-01-15",
				status: "PRESENT",
				courseId: "65f0c1a2b3c4d5e6f7a8b9c0",
			}),
		).toThrow();
	});

	it("requires a date on the PUT body", () => {
		expect(() => putAttendanceInput.parse({ status: "PRESENT" })).toThrow();
	});
});

describe("cross-field refinement", () => {
	it("rejects a semester that ends before it starts", () => {
		expect(() =>
			createSemesterInput.parse({
				name: "Spring 2026",
				startDate: "2026-06-01",
				endDate: "2026-01-01",
			}),
		).toThrow();
		expect(() =>
			createSemesterInput.parse({
				name: "Spring 2026",
				startDate: "2026-01-01",
				endDate: "2026-06-01",
			}),
		).not.toThrow();
	});

	it("does not apply the create-time refinement to a partial update", () => {
		// `updateSemesterInput` carries no dates, so it must not demand both.
		expect(updateSemesterInput.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
	});
});

describe("result marks", () => {
	const base = { assessmentId: "65f0c1a2b3c4d5e6f7a8b9c0" };

	it("requires marks unless the result is explicitly incomplete", () => {
		expect(() => createResultInput.parse(base)).toThrow();
		expect(() => createResultInput.parse({ ...base, incomplete: true })).not.toThrow();
		expect(() => createResultInput.parse({ ...base, marksObtained: 0 })).not.toThrow();
	});

	it("keeps the same rule on update", () => {
		expect(() => updateResultInput.parse({ marksObtained: 10 })).not.toThrow();
		expect(() => updateResultInput.parse({ incomplete: true })).not.toThrow();
		expect(() => updateResultInput.parse({ note: "regraded" })).toThrow();
	});
});

describe("routine slots", () => {
	it("rejects a slot that ends before it starts", () => {
		expect(() =>
			replaceRoutineInput.parse({
				slots: [{ dayOfWeek: "MONDAY", startTime: "10:00", endTime: "09:00" }],
			}),
		).toThrow();
	});

	it("accepts a valid slot and defaults the room", () => {
		const parsed = replaceRoutineInput.parse({
			slots: [{ dayOfWeek: "MONDAY", startTime: "09:00", endTime: "10:00" }],
		});
		expect(parsed.slots[0].room).toBeNull();
	});

	it("caps the number of slots per course", () => {
		const slots = Array.from({ length: 21 }, (_, i) => ({
			dayOfWeek: "MONDAY",
			startTime: `${String(8 + (i % 12)).padStart(2, "0")}:00`,
			endTime: `${String(8 + (i % 12)).padStart(2, "0")}:30`,
		}));
		expect(() => replaceRoutineInput.parse({ slots })).toThrow();
	});
});

describe("profile fields on /me", () => {
	it("lets a student clear a field with null rather than rejecting it", () => {
		// The edit form writes "" for "not set yet" and the client maps that to
		// null; rejecting it would make a cleared field impossible to save.
		expect(
			updateMeInput.parse({
				name: "Tanvir Ahmed",
				university: "RUET",
				department: null,
				currentSemesterId: null,
				targetCgpa: null,
			}),
		).toEqual({
			name: "Tanvir Ahmed",
			university: "RUET",
			department: null,
			currentSemesterId: null,
			targetCgpa: null,
		});
	});

	it("rejects a target outside the 0–4 scale", () => {
		expect(() => updateMeInput.parse({ targetCgpa: 4.5 })).toThrow();
		expect(() => updateMeInput.parse({ targetCgpa: -0.1 })).toThrow();
		expect(updateMeInput.parse({ targetCgpa: 4 })).toEqual({ targetCgpa: 4 });
	});

	it("keeps role off the student-writable surface", () => {
		expect(() => updateMeInput.parse({ role: "ADMIN" })).toThrow();
	});

	it("backfills the academic fields for a user created before they existed", () => {
		// `authenticate` upserts, so a document written before this release has
		// no academic keys at all. `respond()` throws on a failed parse, which
		// would 500 every request from those existing users.
		const parsed = userSchema.parse({
			id: "656f0c9a8e1b2c3d4e5f6a7b",
			email: "tanvir@example.com",
			name: "Tanvir Ahmed",
			photoUrl: null,
			role: "STUDENT",
			timezone: "Asia/Dhaka",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(parsed.university).toBeNull();
		expect(parsed.department).toBeNull();
		expect(parsed.currentSemesterId).toBeNull();
		expect(parsed.targetCgpa).toBeNull();
	});
});
