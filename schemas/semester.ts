import { z } from "zod";

import { badRequest } from "@/lib/errors";
import { calendarDate, isoDateTime, SemesterIdSchema, OwnerUidSchema } from "@/schemas/common";

export const semesterStatus = z.enum(["ACTIVE", "ARCHIVED"]);
export type SemesterStatus = z.infer<typeof semesterStatus>;

const targetGpa = z.number().min(0).max(4);
const totalWeeks = z.number().int().min(1).max(52);

export const semesterSchema = z.object({
	id: SemesterIdSchema,
	userId: OwnerUidSchema,
	name: z.string(),
	startDate: calendarDate,
	endDate: calendarDate,
	// Defaults let documents written before these fields existed still parse;
	// without them `respond()` would 500 on every older semester.
	status: semesterStatus.default("ACTIVE"),
	targetGpa: targetGpa.nullable().default(null),
	totalWeeks: totalWeeks.nullable().default(null),
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
		/** Optional when `totalWeeks` is sent: it is then derived. */
		endDate: calendarDate.optional(),
		status: semesterStatus.optional(),
		targetGpa: targetGpa.nullable().optional(),
		totalWeeks: totalWeeks.nullable().optional(),
	})
	.refine((data) => data.endDate !== undefined || typeof data.totalWeeks === "number", {
		message: "Send endDate, totalWeeks, or both",
		path: ["endDate"],
	})
	.refine((data) => data.endDate === undefined || data.endDate >= data.startDate, {
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
		status: semesterStatus.optional(),
		targetGpa: targetGpa.nullable().optional(),
		totalWeeks: totalWeeks.nullable().optional(),
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

/**
 * The last day of a term of `weeks` teaching weeks starting on `startDate`.
 * Pure date arithmetic on `YYYY-MM-DD`, done in UTC so no timezone can shift it.
 */
export function endDateFromWeeks(startDate: string, weeks: number): string {
	const date = new Date(`${startDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + weeks * 7 - 1);
	return date.toISOString().slice(0, 10);
}

export const semesterIdParams = z.object({ id: SemesterIdSchema });
export type SemesterIdParams = z.infer<typeof semesterIdParams>;
