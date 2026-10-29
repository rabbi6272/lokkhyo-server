import { connect } from "@/lib/db";
import { firebaseMessaging } from "@/lib/firebase";
import { Device, Notification, PushClaim } from "@/models";
import { sendExpoPushBatch, type ExpoPushMessage } from "@/services/expoPush";

export type PushCategory = "ROUTINE" | "ATTENDANCE" | "ATTENDANCE_RISK" | "DEADLINE" | "GRADE";

/** The Android channel the app creates for server notifications. */
export const SERVER_PUSH_CHANNEL = "server-alerts";

export interface PushMessage {
	category: PushCategory;
	title: string;
	body: string;
	/** In-app route the notification opens, e.g. `/(tabs)/attendance`. */
	link: string | null;
}

/** FCM errors that mean the token will never work again. */
const DEAD_TOKEN_CODES = new Set([
	"messaging/registration-token-not-registered",
	"messaging/invalid-registration-token",
	"messaging/invalid-argument",
]);

const DUPLICATE_KEY = 11000;

/**
 * Claim `(userId, key)` for delivery. Exactly one caller ever gets `true`, so
 * overlapping or retried dispatch runs cannot send the same push twice.
 */
export async function claimPush(userId: string, key: string): Promise<boolean> {
	await connect();
	try {
		await PushClaim.create({ userId, key });
		return true;
	} catch (error) {
		if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
		throw error;
	}
}

/**
 * Record a notification in the student's in-app list, then push it to every
 * registered device (Android and iOS). Returns how many devices accepted it.
 *
 * Supports Expo Push and FCM (dual-run mode controlled by `PUSH_PROVIDER=expo|fcm|both`).
 * If a device has an Expo token, it uses Expo Push; otherwise falls back to FCM.
 *
 * The in-app row is written first and kept even if push fails: the list is the
 * durable record, the push is the nudge.
 */
export async function sendPush(userId: string, message: PushMessage): Promise<number> {
	await connect();

	const notification = await Notification.create({
		userId,
		category: message.category,
		title: message.title,
		body: message.body,
		link: message.link,
	});

	const devices = await Device.find({ userId })
		.select("fcmToken expoPushToken pushProvider platform")
		.lean<Array<{ fcmToken?: string | null; expoPushToken?: string | null; pushProvider?: string; platform: string }>>();
	if (devices.length === 0) return 0;

	const providerMode = (process.env.PUSH_PROVIDER ?? "both").toLowerCase();

	const expoTokens: string[] = [];
	const fcmTokens: string[] = [];

	for (const device of devices) {
		if (device.expoPushToken && providerMode !== "fcm") {
			expoTokens.push(device.expoPushToken);
		} else if (device.fcmToken && providerMode !== "expo") {
			fcmTokens.push(device.fcmToken);
		}
	}

	let totalSent = 0;

	// 1. Send to Expo Push devices (Android & iOS)
	if (expoTokens.length > 0) {
		const expoMessages: ExpoPushMessage[] = expoTokens.map((to) => ({
			to,
			title: message.title,
			body: message.body,
			data: {
				type: "server-push",
				category: message.category,
				link: message.link ?? "",
				notificationId: String(notification._id),
			},
			sound: "default",
			priority: "high",
			channelId: SERVER_PUSH_CHANNEL,
		}));

		totalSent += await sendExpoPushBatch(userId, expoMessages);
	}

	// 2. Send to legacy FCM devices (if any remain during migration window)
	if (fcmTokens.length > 0) {
		try {
			const response = await firebaseMessaging().sendEachForMulticast({
				tokens: fcmTokens,
				notification: { title: message.title, body: message.body },
				data: {
					type: "server-push",
					category: message.category,
					link: message.link ?? "",
					notificationId: String(notification._id),
				},
				android: {
					priority: "high",
					notification: { channelId: SERVER_PUSH_CHANNEL },
				},
			});

			const dead = response.responses
				.map((result, index) =>
					result.error && DEAD_TOKEN_CODES.has(result.error.code) ? fcmTokens[index] : null,
				)
				.filter((token): token is string => token !== null);
			if (dead.length > 0) {
				await Device.deleteMany({ fcmToken: { $in: dead } });
			}

			totalSent += response.successCount;
		} catch (error) {
			console.error("[push] FCM send error:", error);
		}
	}

	return totalSent;
}
