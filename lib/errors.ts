/**
 * The single error vocabulary for the whole API.
 *
 * Every failure the client can observe is one of these codes. That is the point:
 * a consumer that knows the code list can branch on `code` and never parse
 * `message` text. Message strings are for humans and may change.
 */

export const ErrorCode = {
	/** Body was not parseable JSON, or a required structural field was absent. */
	BAD_REQUEST: "BAD_REQUEST",
	/** No bearer token, or the token failed verification. */
	UNAUTHENTICATED: "UNAUTHENTICATED",
	/** Authenticated, but not permitted. Reserved: v1 is single-role. */
	FORBIDDEN: "FORBIDDEN",
	/** The addressed resource does not exist, or is not visible to this user. */
	NOT_FOUND: "NOT_FOUND",
	/** State conflict, including guarded deletes and in-flight idempotency keys. */
	CONFLICT: "CONFLICT",
	/** Payload was well-formed JSON but failed schema validation. */
	VALIDATION_ERROR: "VALIDATION_ERROR",
	/** An Idempotency-Key was replayed with a different request body. */
	IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
	/** A state-changing endpoint was called without the key it requires. */
	IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
	RATE_LIMITED: "RATE_LIMITED",
	/** Unexpected server fault. Details are never leaked to the client. */
	INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	BAD_REQUEST: 400,
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	VALIDATION_ERROR: 422,
	IDEMPOTENCY_KEY_REUSED: 422,
	IDEMPOTENCY_KEY_REQUIRED: 400,
	RATE_LIMITED: 429,
	INTERNAL_ERROR: 500,
};

export interface ErrorBody {
	error: {
		code: ErrorCode;
		message: string;
		details?: unknown;
	};
}

/**
 * The only error type route handlers are expected to throw. Anything else that
 * escapes a handler is treated as an unknown fault and reported as
 * INTERNAL_ERROR without leaking its message, so a stray driver error can never
 * surface internals to a client.
 */
export class AppError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	readonly details?: unknown;

	constructor(code: ErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = "AppError";
		this.code = code;
		this.status = STATUS_BY_CODE[code];
		this.details = details;
	}

	toBody(): ErrorBody {
		return {
			error: {
				code: this.code,
				message: this.message,
				...(this.details === undefined ? {} : { details: this.details }),
			},
		};
	}
}

export const badRequest = (message: string, details?: unknown) =>
	new AppError(ErrorCode.BAD_REQUEST, message, details);

export const notFound = (message = "Resource not found") =>
	new AppError(ErrorCode.NOT_FOUND, message);

/**
 * Guarded delete. `count` describes the child records that would be orphaned,
 * so the client can tell the user exactly what a cascade would destroy.
 */
export const conflict = (message: string, details?: unknown) =>
	new AppError(ErrorCode.CONFLICT, message, details);

export const internal = (message = "Internal server error") =>
	new AppError(ErrorCode.INTERNAL_ERROR, message);
