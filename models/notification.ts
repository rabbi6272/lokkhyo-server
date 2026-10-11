import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

const DeviceSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		fcmToken: { type: String, required: true },
		platform: { type: String, enum: ["ANDROID", "IOS"], required: true },
		deviceName: { type: String, default: null },
		lastSeenAt: { type: Date, default: Date.now },
	},
	{ timestamps: true, collection: "deviceTokens", versionKey: false },
);

/**
 * Makes device registration an upsert. A client that re-registers on every
 * launch — which is the normal pattern for FCM tokens, since they rotate — is
 * idempotent for free, with no idempotency key involved.
 */
DeviceSchema.index({ userId: 1, fcmToken: 1 }, { unique: true });

export type DeviceDocument = InferSchemaType<typeof DeviceSchema> & { _id: unknown };

export const Device = defineModel("Device", DeviceSchema);

const NotificationPrefsSchema = new Schema(
	{
		userId: { type: String, required: true },
		timezone: { type: String, default: "Asia/Dhaka" },
		/** Local wall-clock times. The cron job matches these per user. */
		morningRoutineTime: { type: String, default: "07:00" },
		eveningAttendanceTime: { type: String, default: "20:00" },
		categoriesEnabled: {
			type: new Schema(
				{
					ROUTINE: { type: Boolean, default: true },
					ATTENDANCE: { type: Boolean, default: true },
					ATTENDANCE_RISK: { type: Boolean, default: true },
					DEADLINE: { type: Boolean, default: true },
					GRADE: { type: Boolean, default: true },
				},
				{ _id: false },
			),
			default: () => ({}),
		},
		/** Sessions before this local hour are treated as over. */
		attendanceCutoffHour: { type: Number, default: 20 },
	},
	{ timestamps: true, collection: "notificationPrefs", versionKey: false },
);

NotificationPrefsSchema.index({ userId: 1 }, { unique: true });

export type NotificationPrefsDocument = InferSchemaType<
	typeof NotificationPrefsSchema
> & { _id: unknown };

export const NotificationPrefs = defineModel("NotificationPrefs", NotificationPrefsSchema);

const NotificationSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		category: {
			type: String,
			enum: ["ROUTINE", "ATTENDANCE", "ATTENDANCE_RISK", "DEADLINE", "GRADE"],
			required: true,
		},
		title: { type: String, required: true },
		body: { type: String, required: true },
		/** Deep link, e.g. `lokkhyo://attendance`. */
		link: { type: String, default: null },
		readAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: "notifications", versionKey: false },
);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });

export type NotificationDocument = InferSchemaType<typeof NotificationSchema> & {
	_id: unknown;
};

export const Notification = defineModel("Notification", NotificationSchema);
