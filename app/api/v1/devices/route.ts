import { created, ok, parseBody, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { deviceSchema, registerDeviceInput } from "@/schemas/notification";
import { listDevices, registerDevice } from "@/services/notification";

const devicePage = pageResponse(deviceSchema);

export const GET = route(async ({ auth, request }) => {
	const page = listDevices(auth.uid, pageRequestFromUrl(new URL(request.url)));
	return ok(respondPage(devicePage, await page));
});

/**
 * `POST /api/v1/devices`
 *
 * Naturally idempotent on the FCM token: re-registering the same device
 * overwrites one row, and a token that moves between students is reassigned
 * rather than left able to receive the previous owner's notifications.
 */
export const POST = route(async ({ auth, request }) => {
	const input = parseBody(registerDeviceInput, await readJson(request));
	return created(respond(deviceSchema, await registerDevice(auth.uid, input)));
});
