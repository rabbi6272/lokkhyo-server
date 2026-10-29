import { connect } from "@/lib/db";
import { Device, PushTicket } from "@/models";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_BATCH_SIZE = 100;
export const RECEIPT_BATCH_SIZE = 1000;
export const RECEIPT_DELAY_MINUTES = 15;

export interface ExpoPushMessage {
	to: string;
	title: string;
	body: string;
	data?: Record<string, string>;
	sound?: "default";
	priority?: "default" | "normal" | "high";
	channelId?: string;
}

interface ExpoTicketSuccess {
	status: "ok";
	id: string;
}

interface ExpoTicketError {
	status: "error";
	message: string;
	details?: { error?: string };
}

type ExpoTicket = ExpoTicketSuccess | ExpoTicketError;

interface ExpoReceiptSuccess {
	status: "ok";
}

interface ExpoReceiptError {
	status: "error";
	message: string;
	details?: { error?: string };
}

type ExpoReceipt = ExpoReceiptSuccess | ExpoReceiptError;

/**
 * Validates whether a token string is a valid Expo Push token.
 */
export function isExpoPushToken(token: string): boolean {
	return typeof token === "string" && /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token.trim());
}

/**
 * Split array into chunks of `size`.
 */
export function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

function getExpoHeaders(): HeadersInit {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
		"Accept-Encoding": "gzip, deflate",
	};
	if (process.env.EXPO_ACCESS_TOKEN) {
		headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
	}
	return headers;
}

/**
 * Sends a batch of push notifications to Expo Push Service (up to 100 per chunk).
 * Stores accepted tickets for receipt checking and removes unregistered devices immediately.
 */
export async function sendExpoPushBatch(
	userId: string,
	messages: ExpoPushMessage[],
): Promise<number> {
	if (messages.length === 0) return 0;
	await connect();

	const validMessages = messages.filter((m) => isExpoPushToken(m.to));
	if (validMessages.length === 0) return 0;

	let successCount = 0;
	const chunks = chunk(validMessages, EXPO_BATCH_SIZE);

	for (const batch of chunks) {
		try {
			const res = await fetch(EXPO_PUSH_URL, {
				method: "POST",
				headers: getExpoHeaders(),
				body: JSON.stringify(batch),
			});

			if (!res.ok) {
				console.error(`[expoPush] send failed HTTP ${res.status}: ${await res.text()}`);
				continue;
			}

			const json = (await res.json()) as { data?: ExpoTicket[] };
			const tickets = json.data ?? [];

			const ticketsToSave: Array<{ userId: string; ticketId: string; expoPushToken: string }> = [];
			const deadTokens: string[] = [];

			tickets.forEach((ticket, index) => {
				const message = batch[index];
				if (ticket.status === "ok") {
					successCount += 1;
					ticketsToSave.push({
						userId,
						ticketId: ticket.id,
						expoPushToken: message.to,
					});
				} else {
					console.warn(`[expoPush] ticket error for ${message.to}:`, ticket.message, ticket.details);
					if (ticket.details?.error === "DeviceNotRegistered") {
						deadTokens.push(message.to);
					}
				}
			});

			if (ticketsToSave.length > 0) {
				await PushTicket.insertMany(ticketsToSave, { ordered: false }).catch((err) => {
					console.error("[expoPush] error saving tickets:", err);
				});
			}

			if (deadTokens.length > 0) {
				await Device.deleteMany({ expoPushToken: { $in: deadTokens } });
			}
		} catch (error) {
			console.error("[expoPush] request error:", error);
		}
	}

	return successCount;
}

/**
 * Sweeps pending push tickets older than 15 minutes, checks their receipts,
 * and prunes dead devices.
 */
export async function processPendingPushReceipts(): Promise<{ checked: number; pruned: number }> {
	await connect();
	const cutoff = new Date(Date.now() - RECEIPT_DELAY_MINUTES * 60 * 1000);

	const tickets = await PushTicket.find({ createdAt: { $lte: cutoff } })
		.limit(RECEIPT_BATCH_SIZE)
		.lean<Array<{ _id: unknown; ticketId: string; expoPushToken: string }>>();

	if (tickets.length === 0) return { checked: 0, pruned: 0 };

	const ticketMap = new Map(tickets.map((t) => [t.ticketId, t]));
	const ticketIds = Array.from(ticketMap.keys());
	let pruned = 0;

	try {
		const res = await fetch(EXPO_RECEIPTS_URL, {
			method: "POST",
			headers: getExpoHeaders(),
			body: JSON.stringify({ ids: ticketIds }),
		});

		if (!res.ok) {
			console.error(`[expoPush] getReceipts failed HTTP ${res.status}: ${await res.text()}`);
			return { checked: 0, pruned: 0 };
		}

		const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
		const receipts = json.data ?? {};
		const resolvedTicketIds: string[] = [];
		const deadTokens: string[] = [];

		for (const [ticketId, receipt] of Object.entries(receipts)) {
			resolvedTicketIds.push(ticketId);
			const ticket = ticketMap.get(ticketId);
			if (!ticket) continue;

			if (receipt.status === "error") {
				console.warn(
					`[expoPush] receipt error for ticket ${ticketId} (${ticket.expoPushToken}):`,
					receipt.message,
					receipt.details,
				);
				if (receipt.details?.error === "DeviceNotRegistered") {
					deadTokens.push(ticket.expoPushToken);
					pruned += 1;
				}
			}
		}

		if (deadTokens.length > 0) {
			await Device.deleteMany({ expoPushToken: { $in: deadTokens } });
		}

		if (resolvedTicketIds.length > 0) {
			await PushTicket.deleteMany({ ticketId: { $in: resolvedTicketIds } });
		}
	} catch (error) {
		console.error("[expoPush] receipts error:", error);
	}

	return { checked: ticketIds.length, pruned };
}

/**
 * Removes device registrations that haven't been active in 90 days.
 */
export async function pruneStaleDevices(olderThanDays = 90): Promise<number> {
	await connect();
	const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
	const result = await Device.deleteMany({ lastSeenAt: { $lt: cutoff } });
	return result.deletedCount ?? 0;
}

