import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "@/lib/model";

const SchedulerStateSchema = new Schema(
	{
		_id: { type: String, required: true },
		lastRunAt: { type: Date, default: null },
		lastSuccessAt: { type: Date, default: null },
		lockedUntil: { type: Date, default: () => new Date(0) },
	},
	{ collection: "schedulerState", versionKey: false },
);

export type SchedulerStateDocument = InferSchemaType<typeof SchedulerStateSchema>;

export const SchedulerState = defineModel("SchedulerState", SchedulerStateSchema);

