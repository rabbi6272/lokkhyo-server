import { describe, expect, it, vi, beforeEach } from "vitest";
import { Types } from "mongoose";

// Mock external DB and services where appropriate
vi.mock("@/lib/db", () => ({
	connect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/push", () => ({
	claimPush: vi.fn().mockResolvedValue(true),
	sendPush: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/services/deadline", () => ({
	dueReminders: vi.fn(),
	claimReminder: vi.fn(),
}));

vi.mock("@/models", () => ({
	Course: {
		find: vi.fn().mockReturnValue({
			select: vi.fn().mockReturnValue({
				lean: vi.fn().mockResolvedValue([
					{ _id: new Types.ObjectId("65f1c0ffee00000000000001"), code: "CSE 3105" },
				]),
			}),
		}),
	},
}));

import { dueReminders, claimReminder } from "@/services/deadline";
import { sendPush } from "@/services/push";
import { deadlineReminders } from "@/services/dispatch";

describe("deadlineReminders dispatch step", () => {
	const userId = "test-user-123";
	const timezone = "Asia/Dhaka";
	const courseId = new Types.ObjectId("65f1c0ffee00000000000001");
	const deadlineId = new Types.ObjectId("65f1c0ffee00000000000099");

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends push for due lead time and claims it atomically", async () => {
		const now = new Date("2026-10-24T12:00:00Z");
		// Due in 20 hours -> 24h lead time window has opened!
		const dueAt = new Date("2026-10-25T08:00:00Z");

		(dueReminders as any).mockResolvedValueOnce([
			{
				_id: deadlineId,
				title: "CT 2",
				type: "ASSESSMENT",
				assessmentType: "CT",
				dueAt,
				courseId,
				reminderLeadTimes: [72, 24],
				remindersSent: [{ leadTimeHours: 72, sentAt: new Date("2026-10-22T08:00:00Z") }],
			},
		]);

		(claimReminder as any).mockResolvedValueOnce(true);

		const sentCount = await deadlineReminders(userId, timezone, now);

		expect(sentCount).toBe(1);
		expect(claimReminder).toHaveBeenCalledWith(userId, String(deadlineId), 24);
		expect(sendPush).toHaveBeenCalledWith(userId, {
			category: "DEADLINE",
			title: expect.stringContaining("CSE 3105 · CT 2"),
			body: expect.stringContaining("Tap to view details."),
			link: `/course/${String(courseId)}`,
		});
	});

	it("does not count a reminder no device accepted", async () => {
		(dueReminders as any).mockResolvedValueOnce([
			{
				_id: deadlineId,
				title: "CT 2",
				type: "ASSESSMENT",
				assessmentType: "CT",
				dueAt: new Date("2026-10-25T08:00:00Z"),
				courseId,
				reminderLeadTimes: [24],
				remindersSent: [],
			},
		]);
		(claimReminder as any).mockResolvedValueOnce(true);
		(sendPush as any).mockResolvedValueOnce(0);

		const sentCount = await deadlineReminders(userId, timezone, new Date("2026-10-24T12:00:00Z"));

		expect(sendPush).toHaveBeenCalledOnce();
		expect(sentCount).toBe(0);
	});

	it("does not send push if the lead time has not yet arrived", async () => {
		const now = new Date("2026-10-23T00:00:00Z");
		// Due in 50 hours. Lead times are [72, 24].
		// 72h window opened (at 50h, now >= 72h trigger) and was already sent.
		// 24h window has not opened yet (50h > 24h).
		const dueAt = new Date("2026-10-25T02:00:00Z");

		(dueReminders as any).mockResolvedValueOnce([
			{
				_id: deadlineId,
				title: "Assignment 1",
				type: "ASSESSMENT",
				assessmentType: "ASSIGNMENT",
				dueAt,
				courseId,
				reminderLeadTimes: [72, 24],
				remindersSent: [{ leadTimeHours: 72, sentAt: new Date("2026-10-22T02:00:00Z") }],
			},
		]);

		const sentCount = await deadlineReminders(userId, timezone, now);

		expect(sentCount).toBe(0);
		expect(claimReminder).not.toHaveBeenCalled();
		expect(sendPush).not.toHaveBeenCalled();
	});

	it("does not send duplicate push on a retried dispatch run", async () => {
		const now = new Date("2026-10-24T12:00:00Z");
		const dueAt = new Date("2026-10-25T08:00:00Z");

		// Both 72 and 24 are in remindersSent
		(dueReminders as any).mockResolvedValueOnce([
			{
				_id: deadlineId,
				title: "CT 2",
				type: "ASSESSMENT",
				assessmentType: "CT",
				dueAt,
				courseId,
				reminderLeadTimes: [72, 24],
				remindersSent: [
					{ leadTimeHours: 72, sentAt: new Date("2026-10-22T08:00:00Z") },
					{ leadTimeHours: 24, sentAt: new Date("2026-10-24T08:00:00Z") },
				],
			},
		]);

		const sentCount = await deadlineReminders(userId, timezone, now);

		expect(sentCount).toBe(0);
		expect(claimReminder).not.toHaveBeenCalled();
		expect(sendPush).not.toHaveBeenCalled();
	});

	it("does not send push if atomic claim fails (race condition with another worker)", async () => {
		const now = new Date("2026-10-24T12:00:00Z");
		const dueAt = new Date("2026-10-25T08:00:00Z");

		(dueReminders as any).mockResolvedValueOnce([
			{
				_id: deadlineId,
				title: "CT 2",
				type: "ASSESSMENT",
				assessmentType: "CT",
				dueAt,
				courseId,
				reminderLeadTimes: [24],
				remindersSent: [],
			},
		]);

		// Another worker claimed it first
		(claimReminder as any).mockResolvedValueOnce(false);

		const sentCount = await deadlineReminders(userId, timezone, now);

		expect(sentCount).toBe(0);
		expect(claimReminder).toHaveBeenCalledWith(userId, String(deadlineId), 24);
		expect(sendPush).not.toHaveBeenCalled();
	});

	it("returns 0 and makes no calls when there are no due deadlines", async () => {
		(dueReminders as any).mockResolvedValueOnce([]);

		const sentCount = await deadlineReminders(userId, timezone, new Date());

		expect(sentCount).toBe(0);
		expect(claimReminder).not.toHaveBeenCalled();
		expect(sendPush).not.toHaveBeenCalled();
	});
});

