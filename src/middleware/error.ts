import type { ErrorHandler } from "hono";

import { AppError, ErrorCode, internal } from "@/lib/errors";

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === DUPLICATE_KEY
	);
}

export const errorHandler: ErrorHandler = (error, c) => {
	if (error instanceof AppError) {
		return c.json(error.toBody(), error.status as any);
	}

	if (isDuplicateKey(error)) {
		return c.json(
			new AppError(ErrorCode.CONFLICT, "That record already exists").toBody(),
			409,
		);
	}

	if (error instanceof Error) {
		console.error("Unhandled error in route handler:", error);
	}

	return c.json(internal().toBody(), 500);
};

