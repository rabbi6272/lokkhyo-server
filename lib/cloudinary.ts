import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

import { internal } from "@/lib/errors";
import { photoPublicId } from "@/lib/photo";

/**
 * Cloudinary, configured lazily and only once.
 *
 * Initialising on import would make `lib/photo` code and any module that
 * transitively reaches it throw at load time when the credentials are absent —
 * the shape that already broke `lib/db.ts` once. Configuration belongs at the
 * moment of use, and a missing credential is reported as a failed request.
 *
 * Cloudinary's SDK throws its own error types, whose messages can carry the
 * cloud name, the request, and the API key. Nothing from here ever reaches a
 * caller: `handleError` only forwards `AppError`, so anything escaping these
 * functions becomes a generic 500.
 */
function uploader() {
	if (process.env.CLOUDINARY_URL) {
		cloudinary.config(true);
		return cloudinary.uploader;
	}

	const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
	const apiKey = process.env.CLOUDINARY_API_KEY;
	const apiSecret = process.env.CLOUDINARY_API_SECRET;

	if (!cloudName || !apiKey || !apiSecret) {
		throw internal(
			"Photo storage is not configured on this server (CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)",
		);
	}

	cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
	return cloudinary.uploader;
}

type UploadOptions = {
	publicId: string;
	/** Purge the CDN copy when an overwrite changes the bytes behind a fixed URL. */
	invalidate: boolean;
};

function uploadBuffer(buffer: Buffer, options: UploadOptions): Promise<UploadApiResponse> {
	return new Promise((resolve, reject) => {
		const stream = uploader().upload_stream(
			{
				// The id is written in full rather than as `folder` + a bare name:
				// one field, one meaning, no chance of the two composing into a
				// path nobody wrote down.
				public_id: options.publicId,
				// Without this an upload to an existing id fails outright, so a
				// second photo could never replace the first.
				overwrite: true,
				resource_type: "image",
				invalidate: options.invalidate,
			},
			(error, result) => {
				if (error) {
					reject(error);
				} else if (result) {
					resolve(result);
				} else {
					reject(new Error("Cloudinary returned no upload result"));
				}
			},
		);

		stream.end(buffer);
	});
}

/**
 * Store an already-compressed photo under the caller's fixed id and return its
 * public HTTPS URL.
 *
 * The buffer arriving here is produced by the service layer's compressor, never
 * by the client — see `setProfilePhoto`.
 */
export async function storeProfilePhoto(userId: string, buffer: Buffer): Promise<string> {
	const publicId = photoPublicId(userId);

	let secureUrl: string;
	try {
		const result = await uploadBuffer(buffer, { publicId, invalidate: true });
		secureUrl = assertUploaded(result);
	} catch (error) {
		if (!isInvalidateRejection(error)) {
			console.error("Cloudinary upload failed:", error);
			throw internal("Photo storage is unavailable");
		}

		// Replacing a photo keeps the same URL, so a client that cached the old
		// image would otherwise keep showing it. `invalidate` is the fix, but it
		// is not available on every Cloudinary account — and an image correctly
		// stored with a stale cache is strictly better than an image we failed to
		// store. Retry once without it; the gap is logged rather than surfaced.
		console.warn(
			"Cloudinary rejected `invalidate`; the photo was stored but its CDN copy may be stale.",
		);
		try {
			const retry = await uploadBuffer(buffer, { publicId, invalidate: false });
			secureUrl = assertUploaded(retry);
		} catch (retryError) {
			console.error("Cloudinary upload failed on retry:", retryError);
			throw internal("Photo storage is unavailable");
		}
	}

	return secureUrl;
}

/**
 * Delete the caller's photo. Absent is success.
 *
 * `"not found"` is accepted because the database and Cloudinary are not one
 * atomic system: the student can hold a `photoUrl` for an asset Cloudinary has
 * already lost. Treating that as an error would strand them with a photo they
 * cannot remove.
 */
export async function dropProfilePhoto(userId: string): Promise<void> {
	let result: { result: string };
	try {
		result = await uploader().destroy(photoPublicId(userId), {
			resource_type: "image",
		});
	} catch (error) {
		console.error("Cloudinary destroy failed:", error);
		throw internal("Photo storage is unavailable");
	}

	// Anything other than these two is a real storage fault (credentials,
	// network, account state) and must not be reported as a completed delete.
	if (result.result !== "ok" && result.result !== "not found") {
		console.error("Cloudinary delete returned an unexpected result:", result);
		throw internal("Photo storage is unavailable");
	}
}

function assertUploaded(result: UploadApiResponse): string {
	if (!result.secure_url) {
		throw new Error("Cloudinary returned no secure_url");
	}
	return result.secure_url;
}

function isInvalidateRejection(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /invalidate/i.test(message);
}

