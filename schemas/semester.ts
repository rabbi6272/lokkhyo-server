import { z } from "zod";

import { badRequest } from "@/lib/errors";
import { calendarDate, isoDateTime, SemesterIdSchema, UserIdSchema } from "@/schemas/common";

export const semesterSchema = z.object({
	id: SemesterIdSchema,
	userId: UserIdSchema,
	name: z.string(),
	startDate: calendarDate,
	endDate: calendarDate,
	createdAt: isoDateTime,
	updatedAt: isoDateTime,
});

export type Semester = z.infer<typeof semesterSchema>;

/**
 * A semester is a container, and MongoDB will not cascade for us. Rather than
 * silently destroying a term of data — which would move the student's CGPA with
 * no visible cause — creation is rejected if the dates are inconsistent, and
 * deletion is guarded separately by the route.
 *
 * The refinement is attached to the schema the route parses, not to a separate
 * wrapper. A rule that lives on an unused export is not a rule.
 */
export const createSemesterInput = z
	.strictObject({
		name: z.string().min(1).max(80),
		startDate: calendarDate,
		endDate: calendarDate,
	})
	.refine((data) => data.endDate >= data.startDate, {
		message: "endDate must be on or after startDate",
		path: ["endDate"],
	});

export type CreateSemesterInput = z.infer<typeof createSemesterInput>;

/**
 * A partial update cannot check ordering against a field the client did not
 * send, so it only validates when both dates are present. The route merges the
 * patch onto the stored semester and re-checks there, which is the only place
 * where both halves are known.
 */
export const updateSemesterInput = z
	.strictObject({
		name: z.string().min(1).max(80).optional(),
		startDate: calendarDate.optional(),
		endDate: calendarDate.optional(),
	})
	.partial()
	.refine(
		(data) =>
			data.startDate === undefined ||
			data.endDate === undefined ||
			data.endDate >= data.startDate,
		{ message: "endDate must be on or after startDate", path: ["endDate"] },
	);

export type UpdateSemesterInput = z.infer<typeof updateSemesterInput>;

/**
 * Reject a patch that, once merged onto the stored dates, would invert the
 * term. Call this with the merged result — the schema above cannot see the
 * stored half.
 */
export function assertSemesterDates(startDate: string, endDate: string): void {
	if (endDate < startDate) {
		throw badRequest("endDate must be on or after startDate", {
			field: "endDate",
		});
	}
}

export const semesterIdParams = z.object({ id: SemesterIdSchema });
export type SemesterIdParams = z.infer<typeof semesterIdParams>;
