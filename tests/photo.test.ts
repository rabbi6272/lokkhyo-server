import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
	ALLOWED_PHOTO_TYPES,
	MAX_PHOTO_BYTES,
	ownsPhotoPath,
	photoFolder,
	photoPublicId,
	stripExtension,
} from "@/lib/photo";
import { compressPhoto } from "@/services/photo";
import { uploadPhotoInput } from "@/schemas/photo";

const MB = 1024 * 1024;

async function solidPng(width: number, height: number): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } },
	})
		.png()
		.toBuffer();
}

/** Random pixels, which PNG cannot compress — so the result is a genuinely large input. */
async function noisyPng(width: number, height: number): Promise<Buffer> {
	const raw = Buffer.allocUnsafe(width * height * 3);
	for (let i = 0; i < raw.length; i += 1) {
		raw[i] = (Math.random() * 256) | 0;
	}
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

describe("photo storage ids", () => {
	it("places every asset under the caller's folder", () => {
		expect(photoFolder("abc123")).toBe("Users/abc123");
	});

	it("reuses one fixed public id per user, so replacing cannot orphan", () => {
		expect(photoPublicId("abc123")).toBe("Users/abc123/photo");
		// Deterministic: the second upload lands on the first upload's id and
		// overwrites it, which is what makes re-upload leak nothing.
		expect(photoPublicId("abc123")).toBe(photoPublicId("abc123"));
	});

	it("never lets one user's id collide with another's", () => {
		expect(photoPublicId("a")).not.toBe(photoPublicId("b"));
	});

	it("recognises only paths inside the caller's own folder", () => {
		expect(ownsPhotoPath("Users/abc123/photo", "abc123")).toBe(true);
		expect(ownsPhotoPath("Users/abc123/photo.webp", "abc123")).toBe(true);
	});

	it("rejects a foreign folder, including a prefix trick", () => {
		expect(ownsPhotoPath("Users/other/photo", "abc123")).toBe(false);
		// A naive `startsWith("Users/" + uid)` would accept `Users/abc1232/photo`
		// for the user `abc123`. Appending the separator is what stops it.
		expect(ownsPhotoPath("Users/abc1232/photo", "abc123")).toBe(false);
	});

	it("strips only a trailing extension", () => {
		expect(stripExtension("Users/a/photo.webp")).toBe("Users/a/photo");
		expect(stripExtension("Users/a/photo")).toBe("Users/a/photo");
		expect(stripExtension("")).toBe("");
	});
});

describe("uploadPhotoInput", () => {
	it("accepts each allowed content type", () => {
		for (const mimeType of ALLOWED_PHOTO_TYPES) {
			expect(uploadPhotoInput.safeParse({ mimeType, size: 1024 }).success).toBe(true);
		}
	});

	it("rejects a content type we do not accept", () => {
		const result = uploadPhotoInput.safeParse({ mimeType: "image/gif", size: 1024 });
		expect(result.success).toBe(false);
	});

	it("accepts a photo exactly at the 3MB limit", () => {
		expect(uploadPhotoInput.safeParse({ mimeType: "image/jpeg", size: 3 * MB }).success).toBe(
			true,
		);
	});

	it("rejects a photo one byte over the 3MB limit", () => {
		expect(
			uploadPhotoInput.safeParse({ mimeType: "image/jpeg", size: 3 * MB + 1 }).success,
		).toBe(false);
	});

	it("rejects an empty file and a fractional size", () => {
		expect(uploadPhotoInput.safeParse({ mimeType: "image/png", size: 0 }).success).toBe(false);
		expect(uploadPhotoInput.safeParse({ mimeType: "image/png", size: 1.5 }).success).toBe(
			false,
		);
	});

	it("ignores unknown keys rather than accepting a smuggled field", () => {
		const result = uploadPhotoInput.safeParse({
			mimeType: "image/png",
			size: 1024,
			url: "https://evil.example/x",
		});
		expect(result.success).toBe(false);
	});

	it("exposes the limit the schema enforces", () => {
		expect(MAX_PHOTO_BYTES).toBe(3 * MB);
	});
});

describe("compressPhoto", () => {
	it("re-encodes an accepted image as WebP", async () => {
		const out = await compressPhoto(await solidPng(400, 400));
		expect(await sharp(out).metadata()).toMatchObject({ format: "webp" });
		expect(out.length).toBeGreaterThan(0);
	});

	it("downscales an oversized image to fit 1920px", async () => {
		const out = await compressPhoto(await solidPng(2400, 2400));
		const meta = await sharp(out).metadata();
		expect(meta.width).toBeLessThanOrEqual(1920);
		expect(meta.height).toBeLessThanOrEqual(1920);
	});

	it("does not enlarge a small image", async () => {
		const out = await compressPhoto(await solidPng(320, 200));
		const meta = await sharp(out).metadata();
		expect(meta.width).toBe(320);
		expect(meta.height).toBe(200);
	});

	it("produces something smaller than a large photographic input", async () => {
		const input = await noisyPng(900, 900);
		expect(input.length).toBeGreaterThan(1 * MB);
		const out = await compressPhoto(input);
		expect(out.length).toBeLessThan(input.length);
	});

	it("keeps every output under the 3MB ceiling", async () => {
		const out = await compressPhoto(await noisyPng(900, 900));
		expect(out.length).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
	});

	it("refuses bytes that are not an image, whatever the client declared", async () => {
		// This is the assertion behind "the Content-Type is a claim": the header
		// could say `image/png` while the body is anything at all.
		const garbage = Buffer.from("#!/bin/sh\nrm -rf /\n");
		await expect(compressPhoto(garbage)).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
		});
	});

	it("refuses a truncated image rather than storing a partial one", async () => {
		const whole = await solidPng(400, 400);
		const truncated = whole.subarray(0, Math.floor(whole.length / 2));
		await expect(compressPhoto(Buffer.from(truncated))).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
		});
	});

	it("refuses an empty buffer", async () => {
		await expect(compressPhoto(Buffer.alloc(0))).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
		});
	});
});
