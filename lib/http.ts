import { z } from "zod";

import { AppError, ErrorCode } from "@/lib/errors";

export function ok<T>(data: T, status = 200): Response {
	return Response.json({ data }, { status });
}

export function created<T>(data: T): Response {
	return ok(data, 201);
}

export function noContent(): Response {
	return new Response(null, { status: 204 });
}

/**
 * Collapse Zod issues into a stable, client-parseable shape. Field paths are
 * the contract; the human-readable message on each issue is not.
 */
function toDetails(error: z.ZodError): unknown {
	return {
		fields: error.issues.map((issue) => ({
			path: issue.path.join("."),
			code: issue.code,
			message: issue.message,
		})),
	};
}

function parseOrThrow<T>(
	schema: z.ZodType<T>,
	value: unknown,
	code: ErrorCode,
	message: string,
): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new AppError(code, message, toDetails(result.error));
	}
	return result.data;
}

export function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
	return parseOrThrow(schema, raw, ErrorCode.VALIDATION_ERROR, "Invalid request body");
}

/**
 * Query parameters arrive as strings, so the schemas they are parsed with are
 * expected to coerce. A malformed value is a client mistake, hence 400.
 */
export function parseQuery<T>(schema: z.ZodType<T>, raw: unknown): T {
	return parseOrThrow(schema, raw, ErrorCode.BAD_REQUEST, "Invalid query parameters");
}

export function parseParams<T>(schema: z.ZodType<T>, raw: unknown): T {
	return parseOrThrow(schema, raw, ErrorCode.BAD_REQUEST, "Invalid path parameters");
}

/**
 * Read and parse a JSON body in one step.
 *
 * A body that is not JSON at all is a 400 rather than a 422: there is no
 * meaningful field-level detail to report about bytes that never parsed.
 */
export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new AppError(ErrorCode.BAD_REQUEST, "Request body must be valid JSON");
	}
}

/**
 * Read a `multipart/form-data` body in one step.
 *
 * A body that is not multipart at all is a 400 rather than a 422: there are no
 * field-level messages to give about bytes that never parsed into parts. Note
 * that an empty multipart body *does* parse, so a missing file is reported by
 * the caller as a missing structural field rather than by this helper.
 */
export async function readFormData(request: Request): Promise<FormData> {
	try {
		return await request.formData();
	} catch {
		throw new AppError(
			ErrorCode.BAD_REQUEST,
			"Request body must be multipart/form-data",
		);
	}
}
