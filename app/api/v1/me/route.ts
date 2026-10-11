import { internal } from "@/lib/errors";
import { ok, parseBody, readJson } from "@/lib/http";
import { User as UserModel } from "@/models";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { updateMeInput, userSchema } from "@/schemas/user";

/**
 * `GET /api/v1/me`
 *
 * The profile is upserted on first authenticated request by `authenticate`, so
 * this route only reads. A student whose token is valid always has a profile,
 * which is why there is no separate registration call.
 */
export const GET = route(async ({ auth }) => {
	return ok(respond(userSchema, auth.user));
});

/**
 * `PATCH /api/v1/me`
 *
 * Only the fields the student owns are writable. `role` is deliberately absent
 * from the input: a self-service endpoint that accepted `role` would let any
 * client promote itself, and v1 has no path that needs it.
 */
export const PATCH = route(async ({ request, auth }) => {
	const input = parseBody(updateMeInput, await readJson(request));

	const updated = await UserModel.findOneAndUpdate(
		{ firebaseUid: auth.uid },
		{ $set: input },
		{ new: true },
	).lean();

	if (!updated) {
		// The profile is created by `authenticate`, so this should be
		// unreachable; treated as a server fault rather than a client error.
		throw internal("Profile is missing for an authenticated user");
	}

	return ok(respond(userSchema, updated));
});
