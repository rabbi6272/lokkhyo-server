import { ok } from "@/lib/http";
import { publicRoute } from "@/lib/route";

/**
 * Liveness and dependency readiness.
 *
 * An unreachable database is reported as `503`, not `500` and not `200`. The
 * body still describes the failure in machine-readable terms, but the status is
 * what a load balancer acts on: a 200 would keep routing traffic to an instance
 * that cannot serve a single request, and a 500 would blur "this instance is
 * broken" into "this instance is fine but had a bad moment".
 */
export const GET = publicRoute(async () => {
	const { connect, mongoose } = await import("@/lib/db");

	// Already connected and healthy, or not yet attempted: either way there is
	// nothing to report beyond "ok".
	if (mongoose.connection.readyState === 1) {
		return ok({ status: "ok", database: "connected" });
	}

	try {
		await connect();
		return ok({ status: "ok", database: "connected" });
	} catch (error) {
		console.error("Health check could not reach the database:", error);
		return ok({ status: "degraded", database: "unreachable" }, 503);
	}
});

export const dynamic = "force-dynamic";
