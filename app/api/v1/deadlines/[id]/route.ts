import { noContent, ok, parseBody, parseParams, readJson } from "@/lib/http";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import {
	deadlineIdParams,
	deadlineSchema,
	updateDeadlineInput,
} from "@/schemas/deadline";
import { deleteDeadline, getDeadline, updateDeadline } from "@/services/deadline";

export const GET = route(async ({ auth, params }) => {
	const { id } = parseParams(deadlineIdParams, params);
	return ok(respond(deadlineSchema, await getDeadline(auth.uid, id)));
});

export const PATCH = route(async ({ auth, params, request }) => {
	const { id } = parseParams(deadlineIdParams, params);
	const input = parseBody(updateDeadlineInput, await readJson(request));
	return ok(respond(deadlineSchema, await updateDeadline(auth.uid, id, input)));
});

/**
 * Already-dispatched reminders are not retracted by deleting the deadline.
 * A push cannot be recalled, and silently pretending otherwise would make the
 * audit trail in `remindersSent` a fiction.
 */
export const DELETE = route(async ({ auth, params }) => {
	const { id } = parseParams(deadlineIdParams, params);
	await deleteDeadline(auth.uid, id);
	return noContent();
});
