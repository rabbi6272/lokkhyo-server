/**
 * Everything about a profile photo that can be decided without touching the
 * network or the database, so it lives here and is unit-tested directly.
 *
 * The central rule: the request never carries a target image identifier. Both
 * routes derive theirs from the verified Firebase uid, so "did we check that
 * this image belongs to the caller" is a question that cannot be asked, let
 * alone answered wrongly.
 */

/** Largest photo a client may *send*. The stored image is always smaller. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/**
 * Declared content types accepted at the boundary. This is the value the client
 * wrote into the part header, so it is a claim rather than a fact — the bytes
 * are inspected separately before anything is uploaded.
 */
export const ALLOWED_PHOTO_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
] as const;

export type AllowedPhotoType = (typeof ALLOWED_PHOTO_TYPES)[number];

/** Form field name. Kept in step with the path (`/me/photo`) rather than the reference app's `profile`. */
export const PHOTO_FIELD = "photo";

/**
 * Every asset an account owns lives under one folder prefix. Cloudinary cannot
 * scope by API key, so ownership is asserted from the path alone.
 */
export function photoFolder(userId: string): string {
	return `Users/${userId}`;
}

/**
 * The one public id an account's photo ever occupies.
 *
 * Fixed rather than randomly generated on purpose: re-uploading over the same
 * id destroys the previous asset as a side effect, so replacing a photo cannot
 * leave an orphan behind, and deletion needs no lookup of "which image is
 * current" in the database. The request is free to supply no identifier at all.
 *
 * The reference app generated a fresh id per upload and only ever deleted the
 * most recent one, so every replacement leaked the old file into Cloudinary.
 */
export function photoPublicId(userId: string): string {
	return `${photoFolder(userId)}/photo`;
}

/** Strip a trailing extension (`.../photo.webp` → `.../photo`) before any prefix comparison. */
export function stripExtension(publicId: string): string {
	return publicId.replace(/\.[^/.]+$/, "");
}

/**
 * Whether a public id sits inside a caller's folder.
 *
 * Both routes derive ids instead of reading them from a request, so this is
 * defence in depth for a future caller that does read one — an explicit guard
 * is cheaper than assuming every future edit remembers the rule.
 */
export function ownsPhotoPath(publicId: string, userId: string): boolean {
	return stripExtension(publicId).startsWith(`${photoFolder(userId)}/`);
}
