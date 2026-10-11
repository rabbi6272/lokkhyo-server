import { z } from "zod";

import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/photo";

/**
 * Validation for an uploaded photo's *described* properties.
 *
 * `file.type` is whatever the client wrote into the multipart part header, so
 * this only settles the cheap question — "does the request claim a format we
 * accept, and is it within budget" — and does so before a single byte is handed
 * to `sharp`. Whether the file really is that format is decided by decoding it
 * in the service layer; a lying header is caught there, not here.
 *
 * Failures are `422 VALIDATION_ERROR` rather than `400`: the request parsed
 * cleanly as multipart, it just describes a file we will not take.
 */
export const uploadPhotoInput = z.strictObject({
	mimeType: z.enum(ALLOWED_PHOTO_TYPES),
	/** Bytes in the raw upload. The stored image is always smaller. */
	size: z
		.number()
		.int("File size must be a whole number of bytes")
		.positive("File is empty")
		.max(MAX_PHOTO_BYTES, `Photo must be at most ${Math.floor(MAX_PHOTO_BYTES / (1024 * 1024))}MB`),
});

export type UploadPhotoInput = z.infer<typeof uploadPhotoInput>;
