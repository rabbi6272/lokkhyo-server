import { noContent, parseParams } from "@/lib/http";
import { route } from "@/lib/route";
import { deviceIdParams } from "@/schemas/notification";
import { deleteDevice } from "@/services/notification";

/**
 * Scoped to the caller, so a guessed id cannot unregister another student's
 * token. Used on sign-out so a shared device stops receiving their pushes.
 */
export const DELETE = route(async ({ auth, params }) => {
	const { id } = parseParams(deviceIdParams, params);
	await deleteDevice(auth.uid, id);
	return noContent();
});
