import { ok, parseBody, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import {
	notificationPrefsSchema,
	updateNotificationPrefsInput,
} from "@/schemas/user";
import {
	getNotificationPrefs,
	updateNotificationPrefs,
} from "@/services/notification";

/**
 * `GET /api/v1/me/notification-prefs`
 *
 * Returns defaults on first read rather than 404. Every other preference field
 * lives on the profile, which already exists by the time a token is valid;
 * making the client call once to discover whether a preferences row exists
 * would be a round trip spent on a certainty.
 */
export const GET = route(async ({ auth }) => {
	return ok(
		respond(notificationPrefsSchema, await getNotificationPrefs(auth.uid)),
	);
});

/**
 * Partial update, so the client sends only what the user changed rather than
 * read-modify-write of the whole document.
 */
export const PATCH = route(async ({ auth, request }) => {
	const input = parseBody(updateNotificationPrefsInput, await readJson(request));
	return ok(
		respond(
			notificationPrefsSchema,
			await updateNotificationPrefs(auth.uid, input),
		),
	);
});
