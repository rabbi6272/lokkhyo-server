import { connect } from "@/lib/db";
import { firebaseMessaging } from "@/lib/firebase";
import { Device, Notification, PushClaim } from "@/models";

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
 * registered device. Returns how many devices accepted it.
 *
 * The in-app row is written first and kept even if FCM fails: the list is the
 * durable record, the push is the nudge. Tokens FCM reports as dead are
 * deleted so they are not retried on every run.
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

	const devices = await Device.find({ userId, platform: "ANDROID" })
		.select("fcmToken")
		.lean<Array<{ fcmToken: string }>>();
	if (devices.length === 0) return 0;

	const tokens = devices.map((device) => device.fcmToken);
	const response = await firebaseMessaging().sendEachForMulticast({
		tokens,
		notification: { title: message.title, body: message.body },
		// FCM data values must be strings.
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
		.map((result, index) => (result.error && DEAD_TOKEN_CODES.has(result.error.code) ? tokens[index] : null))
		.filter((token): token is string => token !== null);
	if (dead.length > 0) {
		await Device.deleteMany({ fcmToken: { $in: dead } });
	}

	return response.successCount;
}
