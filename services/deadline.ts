import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
	buildPage,
	keysetFilter,
	type Page,
	type PageRequest,
} from "@/lib/pagination";
import {
	Assessment as AssessmentModel,
	Course as CourseModel,
	Deadline as DeadlineModel,
} from "@/models";
import type {
	CreateDeadlineInput,
	ListDeadlinesQuery,
	UpdateDeadlineInput,
} from "@/schemas/deadline";

type Lean = { createdAt: Date; updatedAt: Date; _id: Types.ObjectId } & Record<
	string,
	unknown
>;

export async function listDeadlines(
	userId: string,
	page: PageRequest,
	query: ListDeadlinesQuery,
): Promise<Page<Lean>> {
	await connect();

	// Built once rather than spread in. Two conditional spreads that both write
	// `dueAt` would leave a duplicate key, where the second silently wins.
	const dueAt: Record<string, Date> = {};
	if (query.upcoming) {
		dueAt.$gt = new Date();
	}
	if (query.from) {
		dueAt.$gte = new Date(query.from);
	}
	if (query.to) {
		dueAt.$lte = new Date(query.to);
	}

	const docs = await DeadlineModel.find({
		userId,
		...(query.type ? { type: query.type } : {}),
		...(query.courseId ? { courseId: new Types.ObjectId(query.courseId) } : {}),
		...(Object.keys(dueAt).length > 0 ? { dueAt } : {}),
		...keysetFilter(page.cursor),
	})
		.sort({ dueAt: 1, _id: 1 })
		.limit(page.limit + 1)
		.lean<Lean[]>();
	return buildPage(docs, page);
}

export async function getDeadline(userId: string, id: string): Promise<Lean> {
	await connect();
	const deadline = await DeadlineModel.findOne({
		_id: new Types.ObjectId(id),
		userId,
	}).lean<Lean>();
	if (!deadline) {
		throw notFound("Deadline not found");
	}
	return deadline;
}

/**
 * Deadlines reference a course and optionally an assessment.
 *
 * Both references are checked to belong to the caller before they are stored.
 * MongoDB will not enforce this, and a dangling ObjectId would surface much
 * later as an empty course name in the client's deadline list.
 */
export async function createDeadline(
	userId: string,
	input: CreateDeadlineInput,
): Promise<Lean> {
	await connect();

	if (input.courseId) {
		const course = await CourseModel.findOne({
			_id: new Types.ObjectId(input.courseId),
			userId,
		}).lean();
		if (!course) {
			throw notFound("Course not found");
		}
	}

	if (input.assessmentId) {
		const assessment = await AssessmentModel.findOne({
			_id: new Types.ObjectId(input.assessmentId),
			userId,
		}).lean();
		if (!assessment) {
			throw notFound("Assessment not found");
		}
	}

	const created = await DeadlineModel.create({
		userId,
		type: input.type,
		courseId: input.courseId ? new Types.ObjectId(input.courseId) : null,
		assessmentId: input.assessmentId ? new Types.ObjectId(input.assessmentId) : null,
		title: input.title,
		dueAt: new Date(input.dueAt),
		reminderLeadTimes: input.reminderLeadTimes ?? [72, 24],
		remindersSent: [],
	});
	return created.toObject() as Lean;
}

export async function updateDeadline(
	userId: string,
	id: string,
	input: UpdateDeadlineInput,
): Promise<Lean> {
	await connect();
	const updated = await DeadlineModel.findOneAndUpdate(
		{ _id: new Types.ObjectId(id), userId },
		{
			$set: {
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
				...(input.type !== undefined ? { type: input.type } : {}),
			},
		},
		{ new: true },
	).lean<Lean>();
	if (!updated) {
		throw notFound("Deadline not found");
	}
	return updated;
}

export async function deleteDeadline(userId: string, id: string): Promise<void> {
	await connect();
	const deleted = await DeadlineModel.deleteOne({
		_id: new Types.ObjectId(id),
		userId,
	});
	if (deleted.deletedCount === 0) {
		throw notFound("Deadline not found");
	}
}

/**
 * Claim a reminder so a scheduled job cannot double-send.
 *
 * A plain `updateOne` would let two job runs both read "not yet sent" and both
 * push. This flips the per-lead-time flag with a conditional update, so the
 * update matches only one caller: the second run's filter no longer matches and
 * it moves on. The check is atomic at the document, not the application.
 */
export async function claimReminder(
	userId: string,
	deadlineId: string,
	leadTimeHours: number,
): Promise<boolean> {
	await connect();
	const claimed = await DeadlineModel.updateOne(
		{
			_id: new Types.ObjectId(deadlineId),
			userId,
			"remindersSent.leadTimeHours": { $ne: leadTimeHours },
		},
		{ $push: { remindersSent: { leadTimeHours, sentAt: new Date() } } },
	);
	return claimed.modifiedCount === 1;
}

/** Deadlines whose reminder window has opened, for the notification worker. */
export async function dueReminders(userId: string, now = new Date()) {
	await connect();
	return DeadlineModel.find({ userId, dueAt: { $gt: now } })
		.sort({ dueAt: 1 })
		.lean<Array<{
		_id: Types.ObjectId;
		title: string;
		dueAt: Date;
		type: string;
		courseId: Types.ObjectId | null;
		reminderLeadTimes: number[];
		remindersSent: Array<{ leadTimeHours: number; sentAt: Date }>;
	}>>();
}
