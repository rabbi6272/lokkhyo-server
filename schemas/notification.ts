import { z } from "zod";

import {
	DeviceIdSchema,
	isoDateTime,
	notificationCategory,
	NotificationIdSchema,
	platform,
} from "@/schemas/common";

export const pushProvider = z.enum(["FCM", "EXPO"]);
export type PushProvider = z.infer<typeof pushProvider>;

export const deviceSchema = z.object({
	id: DeviceIdSchema,
	fcmToken: z.string().nullable().optional(),
	expoPushToken: z.string().nullable().optional(),
	pushProvider: pushProvider.default("EXPO"),
	platform,
	deviceName: z.string().nullable(),
	createdAt: isoDateTime,
	lastSeenAt: isoDateTime,
});

export type Device = z.infer<typeof deviceSchema>;

/**
 * Registering a device is an upsert on `(userId, expoPushToken)` or `(userId, fcmToken)`,
 * so a client re-registering on launch is naturally idempotent.
 */
export const registerDeviceInput = z
	.strictObject({
		fcmToken: z.string().min(8).max(4096).optional(),
		expoPushToken: z.string().min(8).max(4096).optional(),
		pushProvider: pushProvider.optional(),
		platform,
		deviceName: z.string().max(120).optional(),
	})
	.refine((data) => Boolean(data.expoPushToken || data.fcmToken), {
		message: "Either expoPushToken or fcmToken must be provided",
	});

export type RegisterDeviceInput = z.infer<typeof registerDeviceInput>;

export const deviceIdParams = z.object({ id: DeviceIdSchema });
export type DeviceIdParams = z.infer<typeof deviceIdParams>;

export const notificationSchema = z.object({
	id: NotificationIdSchema,
	category: notificationCategory,
	title: z.string(),
	body: z.string(),
	/** Deep-link target for the app, e.g. `lokkhyo://attendance`. */
	link: z.string().nullable(),
	readAt: isoDateTime.nullable(),
	createdAt: isoDateTime,
});

export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuery = z.object({
	category: notificationCategory.optional(),
	unreadOnly: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default(false),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

export const notificationIdParams = z.object({ id: NotificationIdSchema });
export type NotificationIdParams = z.infer<typeof notificationIdParams>;

/**
 * Mark notifications read.
 *
 * `ids` is optional on purpose: omitting it means "everything", which is what a
 * bell-icon tap should do. A `min(1)` here would make the most common action
 * impossible to express, and would force the client to first page in every id it
 * already has.
 */
export const markNotificationsReadInput = z.strictObject({
	ids: z.array(NotificationIdSchema).min(1).max(200).optional(),
});

export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInput>;

export const healthSchema = z.object({
	status: z.enum(["ok", "degraded"]),
	database: z.enum(["up", "down"]),
	version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;
