import { ok, parseBody, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { markNotificationsReadInput } from "@/schemas/notification";
import { markNotificationsRead } from "@/services/notification";
import { z } from "zod";

import { respond } from "@/lib/serialize";

const readResultSchema = z.object({ updated: z.number().int().nonnegative() });

/**
 * `POST /api/v1/notifications/read`
 *
 * Omitting `ids` marks everything, which is what tapping the bell should do.
 * `readAt: null` is in the filter, so a second call reports zero rather than
 * pretending to re-mark rows it did not touch.
 */
export const POST = route(async ({ auth, request }) => {
	const input = parseBody(markNotificationsReadInput, await readJson(request));
	return ok(respond(readResultSchema, await markNotificationsRead(auth.uid, input)));
});
