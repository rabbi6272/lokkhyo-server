import { AppError, ErrorCode, internal } from "@/lib/errors";
import { authenticate, type AuthContext } from "@/lib/auth";

export interface RouteContext<P> {
	request: Request;
	/** Dynamic segments, already awaited — a Promise in Next.js 16. */
	params: P;
	query: URLSearchParams;
	/** Absent on `publicRoute`. */
	auth?: AuthContext;
}

type RouteParams = Record<string, string>;

/**
 * Convert anything thrown inside a handler into the one error envelope.
 *
 * Only `AppError` is trusted to describe itself. A driver or programming error
 * is reported as a generic 500 with no detail, because its message may contain
 * connection strings, field values, or paths that mean nothing to the caller
 * and everything to an attacker.
 */
export function handleError(error: unknown): Response {
	if (error instanceof AppError) {
		return Response.json(error.toBody(), { status: error.status });
	}

	// A unique index rejected the write. Surfacing it as 409 is far more useful
	// than a 500, and the index is the authority on what is unique.
	if (isDuplicateKey(error)) {
		return Response.json(
			new AppError(
				ErrorCode.CONFLICT,
				"That record already exists",
			).toBody(),
			{ status: 409 },
		);
	}

	if (error instanceof Error) {
		console.error("Unhandled error in route handler:", error);
	}

	return Response.json(internal().toBody(), { status: 500 });
}

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === DUPLICATE_KEY
	);
}

type NextArgs<P extends RouteParams> = { params: Promise<P> };

/**
 * Request logging.
 *
 * Every route under `app/api` is exported through `route` or `publicRoute`, so
 * these two calls are the single place that sees all of them — including a
 * handler that throws before doing anything, and a rejection from
 * `authenticate` that never reaches the handler at all.
 *
 * Arrival and completion are separate lines on purpose. One line printed only
 * on completion cannot tell a slow handler from a request that never arrived,
 * and that distinction is the first thing to establish when a phone cannot
 * reach this server at all.
 *
 * 4xx/5xx go to stderr via `console.warn`, so failures are visually separated
 * from routine traffic without changing the format.
 *
 * Silence it by adding `LOG_REQUESTS=0` to `.env`.
 */
function describe(request: Request): string {
	const url = new URL(request.url);
	return `${request.method} ${url.pathname}${url.search}`;
}

function logArrival(request: Request): void {
	if (process.env.LOG_REQUESTS === "0") return;
	console.log(`→ ${describe(request)}`);
}

function logDone(
	request: Request,
	response: Response,
	started: number,
	uid?: string,
): void {
	if (process.env.LOG_REQUESTS === "0") return;

	const ms = Date.now() - started;
	const identity = uid ? ` uid=${uid}` : "";
	const line = `← ${describe(request)} ${response.status} ${ms}ms${identity}`;

	if (response.status >= 400) {
		console.warn(line);
	} else {
		console.log(line);
	}
}

/**
 * Wrap a handler for a route that requires a verified Firebase ID token.
 *
 * This is the only place errors are caught, so no route handler needs its own
 * try/catch and no route can accidentally return a shape the client has not
 * been taught to parse.
 */
export function route<P extends RouteParams = RouteParams>(
	handler: (context: RouteContext<P> & { auth: AuthContext }) => Promise<Response>,
) {
	return async (request: Request, args?: NextArgs<P>): Promise<Response> => {
		const started = Date.now();
		logArrival(request);

		let uid: string | undefined;
		try {
			const auth = await authenticate(request);
			uid = auth.uid;

			const params = ((await args?.params) ?? {}) as P;
			const response = await handler({
				request,
				params,
				query: new URL(request.url).searchParams,
				auth,
			});

			logDone(request, response, started, uid);
			return response;
		} catch (error) {
			const response = handleError(error);
			logDone(request, response, started, uid);
			return response;
		}
	};
}

/** A route that needs no identity. Used only by `/health`. */
export function publicRoute<P extends RouteParams = RouteParams>(
	handler: (context: RouteContext<P>) => Promise<Response>,
) {
	return async (request: Request, args?: NextArgs<P>): Promise<Response> => {
		const started = Date.now();
		logArrival(request);

		try {
			const params = ((await args?.params) ?? {}) as P;
			const response = await handler({
				request,
				params,
				query: new URL(request.url).searchParams,
			});

			logDone(request, response, started);
			return response;
		} catch (error) {
			const response = handleError(error);
			logDone(request, response, started);
			return response;
		}
	};
}

/**
 * Assert a child record belongs to the caller.
 *
 * v1 is single-role, so ownership is the only authorisation rule that exists.
 * This is centralised rather than repeated per query so that adding roles later
 * has exactly one place to change.
 */
export function assertOwned(
	resource: { userId: string | null | undefined },
	userId: string,
	message = "Resource not found",
): void {
	if (resource.userId !== userId) {
		// 404 rather than 403: confirming that someone else's id exists is
		// itself a leak.
		throw new AppError(ErrorCode.NOT_FOUND, message);
	}
}
