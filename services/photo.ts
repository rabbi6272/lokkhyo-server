import sharp, { type Metadata } from "sharp";

import { dropProfilePhoto, storeProfilePhoto } from "@/lib/cloudinary";
import { connect } from "@/lib/db";
import { AppError, ErrorCode, internal, notFound } from "@/lib/errors";
import { parseBody } from "@/lib/http";
import { MAX_PHOTO_BYTES } from "@/lib/photo";
import { User, type UserDocument } from "@/models";
import { uploadPhotoInput } from "@/schemas/photo";

/** Largest input `sharp` will decode. Sharp's own default is ~268MP. */
const MAX_INPUT_PIXELS = 50_000_000;

/** Stored images never exceed this on either axis, whatever the client sent. */
const MAX_EDGE = 1920;

const WEBP_QUALITY = 80;

const notAnImage = () =>
	new AppError(ErrorCode.VALIDATION_ERROR, "That file is not a valid image.");

type LeanUser = { _id: unknown; createdAt: Date; updatedAt: Date } & Record<string, unknown>;

/**
 * Replace the caller's profile photo.
 *
 * The pipeline is ordered so that each step can only hand a *verified* buffer
 * to the next: the declared type and size are checked first because they cost
 * nothing, the bytes are decoded second because a Content-Type header is a
 * client's claim, and only the buffer this function produced itself is ever
 * handed to Cloudinary. Raw client bytes never reach the network.
 */
export async function setProfilePhoto(userId: string, file: File): Promise<LeanUser> {
	// 422: the multipart body parsed cleanly, it just describes a file we refuse.
	// Checked before decoding because it costs nothing to reject on the header.
	parseBody(uploadPhotoInput, { mimeType: file.type, size: file.size });

	const compressed = await compressPhoto(Buffer.from(await file.arrayBuffer()));
	const photoUrl = await storeProfilePhoto(userId, compressed);
	return savePhotoUrl(userId, photoUrl);
}

/**
 * Decode, resize, and re-encode to WebP — then prove the result.
 *
 * Every input is re-encoded, so a payload disguised as an image is reduced to
 * pixels. In particular an SVG or a file with script in its metadata cannot
 * survive: the output format is forced to `webp` and is verified below, so no
 * image that was not produced here can end up stored.
 *
 * Failure is split by who caused it: anything that goes wrong while reading the
 * client's bytes — undecodable, truncated, a header that lies — is the client's
 * fault and reports 422, while a failure *after* those bytes were successfully
 * re-encoded is a server fault reported as 500 without a detail. In no case does
 * an uncompressed or oversized buffer continue to `storeProfilePhoto`.
 *
 * Exported because it is a pure buffer→buffer transform with no I/O, and it is
 * the one part of this feature whose behaviour types cannot describe.
 */
export async function compressPhoto(raw: Buffer): Promise<Buffer> {
	const input = () => sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS });

	// Reading the client's bytes: header first, then the full re-encode. Both
	// stages are governed by the same input, so a truncated file that reports a
	// width and height from its header but dies mid-decode belongs to the same
	// category as garbage — the client sent something undecodable. Treating it
	// as a server fault would report an outage for a bad upload.
	let meta: Metadata;
	let compressed: Buffer;
	try {
		meta = await input().metadata();
		compressed = await input()
			.resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();
	} catch {
		// Client-caused and already reported as 422; dumping sharp's stack here
		// would fire on every bad upload. A short warning is enough to spot a
		// client repeatedly sending bytes that do not match its declared type.
		console.warn("Photo rejected: the bytes could not be decoded and re-encoded.");
		throw notAnImage();
	}

	if (!meta.width || !meta.height) {
		throw notAnImage();
	}

	// The gate. Nothing leaves this function unless it is provably WebP, non-empty
	// and within budget — the guarantee behind "every photo is compressed".
	let outputMeta: Metadata;
	try {
		outputMeta = await sharp(compressed).metadata();
	} catch (error) {
		console.error("Compressed photo could not be re-read:", error);
		throw internal("Photo could not be processed");
	}

	if (
		outputMeta.format !== "webp" ||
		compressed.length === 0 ||
		compressed.length > MAX_PHOTO_BYTES
	) {
		console.error("Photo compression produced an unacceptable result:", {
			format: outputMeta.format,
			bytes: compressed.length,
		});
		throw internal("Photo could not be processed");
	}

	return compressed;
}

/**
 * Remove the caller's photo from Cloudinary and clear the reference.
 *
 * The delete target is derived from the uid, never read from the request, so
 * there is no public id for a caller to supply on someone else's behalf.
 */
export async function clearProfilePhoto(userId: string): Promise<void> {
	await connect();

	const existing = await User.findOne({ firebaseUid: userId }).lean<LeanUser>();
	if (!existing?.photoUrl) {
		throw notFound("You have no photo to remove.");
	}

	await dropProfilePhoto(userId);
	await savePhotoUrl(userId, null);
}

async function savePhotoUrl(userId: string, photoUrl: string | null): Promise<LeanUser> {
	await connect();

	const updated = await User.findOneAndUpdate(
		{ firebaseUid: userId },
		{ $set: { photoUrl } },
		{ new: true },
	).lean<UserDocument>();

	if (!updated) {
		// `authenticate` provisions the profile on every request, so reaching this
		// means the profile vanished underneath an authenticated call. A fault
		// rather than a client error — and the photo is already stored either way.
		throw internal("Profile is missing for an authenticated user");
	}

	return updated as LeanUser;
}
