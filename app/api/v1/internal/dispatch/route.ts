import { timingSafeEqual } from "node:crypto";

import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/lib/http";
import { publicRoute } from "@/lib/route";
import { runDispatch } from "@/services/dispatch";

/**
 * `GET|POST /api/v1/internal/dispatch` — run the notification dispatch once.
 *
 * Called every ~5 minutes by an external scheduler (Vercel Cron sends `GET`;
 * cron-job.org, GitHub Actions or crontab can send either) with
 * `Authorization: Bearer <CRON_SECRET>`. Not a student endpoint: there is no
 * Firebase token here, only the shared secret.
 *
 * Safe to call as often as you like — every send is claimed exactly once.
 */
async function handle({ request }: { request: Request }): Promise<Response> {
	const secret = process.env.CRON_SECRET;
	if (!secret) {
		console.error("[dispatch] CRON_SECRET is not set; refusing to run");
		throw new AppError(ErrorCode.INTERNAL_ERROR, "Dispatch is not configured");
	}

	const header = request.headers.get("authorization") ?? "";
	const expected = Buffer.from(`Bearer ${secret}`);
	const given = Buffer.from(header);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid dispatch secret");
	}

	return ok(await runDispatch());
}

export const GET = publicRoute(handle);
export const POST = publicRoute(handle);
