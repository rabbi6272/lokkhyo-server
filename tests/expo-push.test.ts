import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	chunk,
	isExpoPushToken,
	processPendingPushReceipts,
	pruneStaleDevices,
	sendExpoPushBatch,
	type ExpoPushMessage,
} from "@/services/expoPush";
import { Device, PushTicket } from "@/models";
import { registerDeviceInput } from "@/schemas/notification";

vi.mock("@/lib/db", () => ({
	connect: vi.fn().mockResolvedValue(undefined),
}));

describe("Expo Push utilities", () => {
	it("validates Expo push tokens correctly", () => {
		expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
		expect(isExpoPushToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
		expect(isExpoPushToken("fcm-token-xyz")).toBe(false);
		expect(isExpoPushToken("")).toBe(false);
		expect(isExpoPushToken("  ")).toBe(false);
	});

	it("chunks arrays into batches of up to 100", () => {
		const items = Array.from({ length: 250 }, (_, i) => i);
		const chunks = chunk(items, 100);
		expect(chunks).toHaveLength(3);
		expect(chunks[0]).toHaveLength(100);
		expect(chunks[1]).toHaveLength(100);
		expect(chunks[2]).toHaveLength(50);
	});
});

describe("registerDeviceInput schema", () => {
	it("accepts expoPushToken without fcmToken", () => {
		const parsed = registerDeviceInput.parse({
			expoPushToken: "ExponentPushToken[abc123def456]",
			platform: "IOS",
			deviceName: "iPhone 15",
		});
		expect(parsed.expoPushToken).toBe("ExponentPushToken[abc123def456]");
		expect(parsed.platform).toBe("IOS");
	});

	it("accepts fcmToken without expoPushToken (legacy Android)", () => {
		const parsed = registerDeviceInput.parse({
			fcmToken: "fcm-raw-device-token-12345",
			platform: "ANDROID",
		});
		expect(parsed.fcmToken).toBe("fcm-raw-device-token-12345");
	});

	it("accepts both tokens during dual-run window", () => {
		const parsed = registerDeviceInput.parse({
			expoPushToken: "ExponentPushToken[abc123def456]",
			fcmToken: "fcm-raw-device-token-12345",
			pushProvider: "EXPO",
			platform: "ANDROID",
		});
		expect(parsed.expoPushToken).toBeDefined();
		expect(parsed.fcmToken).toBeDefined();
		expect(parsed.pushProvider).toBe("EXPO");
	});

	it("rejects when neither token is provided", () => {
		expect(() =>
			registerDeviceInput.parse({
				platform: "ANDROID",
				deviceName: "Pixel 8",
			}),
		).toThrow();
	});
});

describe("sendExpoPushBatch", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("posts messages to Expo and records tickets", async () => {
		const userId = "user-123";
		const token = "ExponentPushToken[valid-token-1]";
		const messages: ExpoPushMessage[] = [
			{
				to: token,
				title: "Test Alert",
				body: "Hello from Lokkhyo",
			},
		];

		const insertManySpy = vi.spyOn(PushTicket, "insertMany").mockResolvedValueOnce([] as any);

		global.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{ status: "ok", id: "ticket-uuid-001" }],
			}),
		} as Response);

		const sent = await sendExpoPushBatch(userId, messages);

		expect(sent).toBe(1);
		expect(global.fetch).toHaveBeenCalledWith(
			"https://exp.host/--/api/v2/push/send",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(insertManySpy).toHaveBeenCalledWith(
			[
				{
					userId,
					ticketId: "ticket-uuid-001",
					expoPushToken: token,
				},
			],
			{ ordered: false },
		);
	});

	it("immediately deletes dead tokens reporting DeviceNotRegistered", async () => {
		const userId = "user-123";
		const deadToken = "ExponentPushToken[dead-token-2]";
		const messages: ExpoPushMessage[] = [
			{
				to: deadToken,
				title: "Test Alert",
				body: "Hello",
			},
		];

		const deleteManySpy = vi.spyOn(Device, "deleteMany").mockResolvedValueOnce({ deletedCount: 1 } as any);

		global.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [
					{
						status: "error",
						message: '"dead-token-2" is not registered',
						details: { error: "DeviceNotRegistered" },
					},
				],
			}),
		} as Response);

		const sent = await sendExpoPushBatch(userId, messages);

		expect(sent).toBe(0);
		expect(deleteManySpy).toHaveBeenCalledWith({
			expoPushToken: { $in: [deadToken] },
		});
	});
});

describe("processPendingPushReceipts", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("queries receipts for pending tickets and deletes resolved ones", async () => {
		const ticketId = "ticket-001";
		const token = "ExponentPushToken[token-1]";

		vi.spyOn(PushTicket, "find").mockReturnValueOnce({
			limit: vi.fn().mockReturnValueOnce({
				lean: vi.fn().mockResolvedValueOnce([
					{
						ticketId,
						expoPushToken: token,
					},
				]),
			}),
		} as any);

		const deleteTicketsSpy = vi.spyOn(PushTicket, "deleteMany").mockResolvedValueOnce({ deletedCount: 1 } as any);

		global.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					[ticketId]: { status: "ok" },
				},
			}),
		} as Response);

		const result = await processPendingPushReceipts();

		expect(result.checked).toBe(1);
		expect(result.pruned).toBe(0);
		expect(deleteTicketsSpy).toHaveBeenCalledWith({
			ticketId: { $in: [ticketId] },
		});
	});

	it("prunes device and deletes ticket when receipt reports DeviceNotRegistered", async () => {
		const ticketId = "ticket-dead";
		const deadToken = "ExponentPushToken[dead-device]";

		vi.spyOn(PushTicket, "find").mockReturnValueOnce({
			limit: vi.fn().mockReturnValueOnce({
				lean: vi.fn().mockResolvedValueOnce([
					{
						ticketId,
						expoPushToken: deadToken,
					},
				]),
			}),
		} as any);

		const deleteDeviceSpy = vi.spyOn(Device, "deleteMany").mockResolvedValueOnce({ deletedCount: 1 } as any);
		const deleteTicketSpy = vi.spyOn(PushTicket, "deleteMany").mockResolvedValueOnce({ deletedCount: 1 } as any);

		global.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					[ticketId]: {
						status: "error",
						message: "Device not registered",
						details: { error: "DeviceNotRegistered" },
					},
				},
			}),
		} as Response);

		const result = await processPendingPushReceipts();

		expect(result.checked).toBe(1);
		expect(result.pruned).toBe(1);
		expect(deleteDeviceSpy).toHaveBeenCalledWith({
			expoPushToken: { $in: [deadToken] },
		});
		expect(deleteTicketSpy).toHaveBeenCalledWith({
			ticketId: { $in: [ticketId] },
		});
	});
});

