import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
	buildPage,
	keysetFilter,
	type Page,
	type PageRequest,
	sortSpec,
	type SortKey,
} from "@/lib/pagination";
import { Device as DeviceModel, Notification as NotificationModel, NotificationPrefs as NotificationPrefsModel } from "@/models";
import type { UpdateNotificationPrefsInput } from "@/schemas/user";
import type {
	ListNotificationsQuery,
	MarkNotificationsReadInput,
	RegisterDeviceInput,
} from "@/schemas/notification";

const LAST_SEEN_DESC: SortKey = { field: "lastSeenAt", direction: -1, kind: "date" };

type Lean = { createdAt: Date; updatedAt: Date; _id: Types.ObjectId } & Record<
	string,
	unknown
>;

/**
 * FCM device registration.
 *
 * `PUT` on the token: the same physical device re-registering is an update, not
 * a new row, so the unique index on `(userId, fcmToken)` can be relied on. A
 * token is also allowed to move between users, so the upsert is keyed on the
 * token and clears any previous owner rather than leaving a stale one able to
 * receive someone else's notifications.
 */
export async function registerDevice(userId: string, input: RegisterDeviceInput) {
	await connect();
	const doc = await DeviceModel.findOneAndUpdate(
		{ fcmToken: input.fcmToken },
		{
			$set: {
				userId,
				platform: input.platform,
				deviceName: input.deviceName ?? null,
				lastSeenAt: new Date(),
			},
		},
		{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
	);
	return doc.toObject();
}

export async function listDevices(userId: string, page: PageRequest): Promise<Page<Lean>> {
	await connect();
	const docs = await DeviceModel.find({ userId, ...keysetFilter(page.cursor, LAST_SEEN_DESC) })
		.sort(sortSpec(LAST_SEEN_DESC))
		.limit(page.limit + 1)
		.lean<Lean[]>();
	return buildPage(docs, page, LAST_SEEN_DESC);
}

/**
 * Unregister a device. Scoped to the caller, so a guessed id cannot remove
 * another student's token.
 */
export async function deleteDevice(userId: string, id: string): Promise<void> {
	await connect();
	const deleted = await DeviceModel.deleteOne({
		_id: new Types.ObjectId(id),
		userId,
	});
	if (deleted.deletedCount === 0) {
		throw notFound("Device not found");
	}
}

export async function listNotifications(
	userId: string,
	page: PageRequest,
	query: ListNotificationsQuery,
): Promise<Page<Lean>> {
	await connect();
	const docs = await NotificationModel.find({
		userId,
		...(query.category ? { category: query.category } : {}),
		...(query.unreadOnly ? { readAt: null } : {}),
		...keysetFilter(page.cursor),
	})
		.sort({ createdAt: -1, _id: -1 })
		.limit(page.limit + 1)
		.lean<Lean[]>();
	return buildPage(docs, page);
}

export async function markNotificationsRead(
	userId: string,
	input: MarkNotificationsReadInput,
) {
	await connect();

	// A missing `ids` means "mark everything", which is the natural meaning of a
	// bell-icon tap. `$in: []` would match nothing, so the two cases diverge
	// before the query is built.
	const filter = input.ids && input.ids.length > 0
		? { _id: { $in: input.ids.map((id) => new Types.ObjectId(id)) } }
		: {};

	const result = await NotificationModel.updateMany(
		{ userId, readAt: null, ...filter },
		{ $set: { readAt: new Date() } },
	);
	return { updated: result.modifiedCount };
}

export async function unreadCount(userId: string) {
	await connect();
	const unread = await NotificationModel.countDocuments({ userId, readAt: null });
	return { unread };
}

/**
 * Notification preferences, created with defaults on first read.
 *
 * `updateOne(..., { upsert: true })` rather than find-then-write: two concurrent
 * first-time reads would otherwise race to insert and one would hit the unique
 * index on `userId`.
 */
export async function getNotificationPrefs(userId: string) {
	await connect();
	const doc = await NotificationPrefsModel.findOneAndUpdate(
		{ userId },
		{ $setOnInsert: { userId } },
		{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
	);
	return doc.toObject();
}

export async function updateNotificationPrefs(
	userId: string,
	input: UpdateNotificationPrefsInput,
) {
	await connect();
	const doc = await NotificationPrefsModel.findOneAndUpdate(
		{ userId },
		{
			$set: {
				...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
				...(input.morningRoutineTime !== undefined
					? { morningRoutineTime: input.morningRoutineTime }
					: {}),
				...(input.eveningAttendanceTime !== undefined
					? { eveningAttendanceTime: input.eveningAttendanceTime }
					: {}),
				...(input.assessmentReminderTime !== undefined
					? { assessmentReminderTime: input.assessmentReminderTime }
					: {}),
				...(input.attendanceCutoffHour !== undefined
					? { attendanceCutoffHour: input.attendanceCutoffHour }
					: {}),
				// Per key, not the whole object: a patch toggling one category
				// must not reset the others the client did not mention.
				...Object.fromEntries(
					Object.entries(input.categoriesEnabled ?? {})
						.filter(([, enabled]) => enabled !== undefined)
						.map(([category, enabled]) => [`categoriesEnabled.${category}`, enabled]),
				),
			},
		},
		{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
	);
	return doc.toObject();
}
