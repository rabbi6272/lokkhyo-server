import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { buildPage, keysetFilter, type Page, type PageRequest } from "@/lib/pagination";
import { Assessment as AssessmentModel, Course as CourseModel, Result as ResultModel } from "@/models";
import { recomputeGpa } from "@/services/gpa";
import type {
	CreateAssessmentInput,
	ListAssessmentsQuery,
	UpdateAssessmentInput,
} from "@/schemas/assessment";

/** A lean Mongo document: the service layer never speaks API shapes. */
type Lean = { createdAt: Date; updatedAt: Date; _id: Types.ObjectId } & Record<string, unknown>;

export async function listAssessments(
	userId: string,
	page: PageRequest,
	query: ListAssessmentsQuery,
): Promise<Page<Lean>> {
	await connect();
	const docs = await AssessmentModel.find({
		userId,
		...(query.courseId ? { courseId: new Types.ObjectId(query.courseId) } : {}),
		...(query.upcoming
			? { date: { $gte: new Date().toISOString().slice(0, 10) } }
			: {}),
		...keysetFilter(page.cursor),
	})
		.sort({ date: -1, _id: -1 })
		.limit(page.limit + 1)
		.lean<Lean[]>();
	return buildPage(docs, page);
}

export async function getAssessment(userId: string, id: string): Promise<Lean> {
	await connect();
	const assessment = await AssessmentModel.findOne({
		_id: new Types.ObjectId(id),
		userId,
	}).lean<Lean>();
	if (!assessment) {
		throw notFound("Assessment not found");
	}
	return assessment;
}

export async function createAssessment(
	userId: string,
	input: CreateAssessmentInput,
): Promise<Lean> {
	await connect();
	const course = await CourseModel.findOne({
		_id: new Types.ObjectId(input.courseId),
		userId,
	}).lean();
	if (!course) {
		throw notFound("Course not found");
	}

	const created = await AssessmentModel.create({
		userId,
		courseId: new Types.ObjectId(input.courseId),
		type: input.type,
		title: input.title,
		date: input.date,
		maxMarks: input.maxMarks,
	});
	return created.toObject() as Lean;
}

export async function updateAssessment(
	userId: string,
	id: string,
	input: UpdateAssessmentInput,
): Promise<Lean> {
	await connect();
	const updated = await AssessmentModel.findOneAndUpdate(
		{ _id: new Types.ObjectId(id), userId },
		{ $set: input },
		{ new: true },
	).lean<Lean>();
	if (!updated) {
		throw notFound("Assessment not found");
	}
	return updated;
}

export async function deleteAssessment(
	userId: string,
	id: string,
	cascade: boolean,
): Promise<void> {
	await connect();
	const objectId = new Types.ObjectId(id);

	const assessment = await AssessmentModel.findOne({ _id: objectId, userId }).lean();
	if (!assessment) {
		throw notFound("Assessment not found");
	}

	const results = await ResultModel.countDocuments({ userId, assessmentId: objectId });

	if (results > 0 && !cascade) {
		throw conflict(
			"This assessment has results. Delete them first, or repeat the request with ?cascade=true.",
			{ results },
		);
	}

	if (cascade && results > 0) {
		await ResultModel.deleteMany({ userId, assessmentId: objectId });
	}

	await AssessmentModel.deleteOne({ _id: objectId, userId });
	await recomputeGpa(userId);
}
