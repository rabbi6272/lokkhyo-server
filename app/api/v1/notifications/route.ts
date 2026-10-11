import { ok, parseQuery } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { route } from "@/lib/route";
import { respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { listNotificationsQuery, notificationSchema } from "@/schemas/notification";
import { listNotifications } from "@/services/notification";

const notificationPage = pageResponse(notificationSchema);

export const GET = route(async ({ auth, request, query }) => {
	const filters = parseQuery(listNotificationsQuery, {
		category: query.get("category") ?? undefined,
		unreadOnly: query.get("unreadOnly") ?? undefined,
	});
	const page = await listNotifications(
		auth.uid,
		pageRequestFromUrl(new URL(request.url)),
		filters,
	);
	return ok(respondPage(notificationPage, page));
});
