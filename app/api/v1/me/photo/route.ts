import { badRequest } from "@/lib/errors";
import { ok, noContent, readFormData } from "@/lib/http";
import { PHOTO_FIELD } from "@/lib/photo";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { userSchema } from "@/schemas/user";
import { clearProfilePhoto, setProfilePhoto } from "@/services/photo";

/**
 * `PUT /api/v1/me/photo` — set or replace the caller's photo.
 *
 * `PUT` rather than `POST` because this replaces one image; it is idempotent by
 * construction (the storage id is derived from the uid, so a retry lands on the
 * same asset), which is why no `Idempotency-Key` is required here even though
 * `POST /results` insists on one.
 *
 * The body is `multipart/form-data` with one part named `photo`. Everything
 * about it — declared type, size, and whether it decodes — is checked before an
 * upload is attempted, and the bytes that are uploaded are re-encoded to WebP
 * first: see `setProfilePhoto`.
 */
export const PUT = route(async ({ auth, request }) => {
	const form = await readFormData(request);
	const file = form.get(PHOTO_FIELD);

	if (!(file instanceof File) || file.size === 0) {
		throw badRequest(
			`No file provided. Send a non-empty file as the multipart part named '${PHOTO_FIELD}'.`,
		);
	}

	return ok(respond(userSchema, await setProfilePhoto(auth.uid, file)));
});

/**
 * `DELETE /api/v1/me/photo` — remove it.
 *
 * Takes no identifier. The image destroyed is always the one under the caller's
 * own uid, so a public id from the request cannot aim this at anyone else's
 * photo — the check that the reference app had to write is unrepresentable here.
 *
 * `204` matches every other delete in the API; the client sets its local
 * `photoUrl` to null rather than refetching the profile.
 */
export const DELETE = route(async ({ auth }) => {
	await clearProfilePhoto(auth.uid);
	return noContent();
});
