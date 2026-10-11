import { ok } from "@/lib/http";
import { gradingScaleDto } from "@/lib/grading";
import { route } from "@/lib/route";
import { respond } from "@/lib/serialize";
import { gradingScaleSchema } from "@/schemas/grade";

/**
 * `GET /api/v1/grading-scale`
 *
 * The scale is served rather than baked into the client. Bands, grade points,
 * the F rule and the degree threshold are institutional policy and differ
 * between cohorts, so a policy change is a server deploy instead of a
 * coordinated release of every install — and the app that displays a grade can
 * never disagree with the server that computed it.
 *
 * Authenticated but with no ownership check: the scale is not user data, yet
 * keeping it behind the token avoids shipping the policy to unauthenticated
 * callers and keeps the route surface uniform.
 */
export const GET = route(async () => {
	return ok(respond(gradingScaleSchema, gradingScaleDto()));
});
