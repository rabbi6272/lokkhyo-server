import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "@/lib/model";

/**
 * Stores Expo push notification delivery tickets for receipt polling.
 *
 * When an Expo push batch is sent, Expo returns tickets containing a ticket ID.
 * After ~15 minutes, the dispatcher queries Expo's getReceipts endpoint to verify
 * delivery and prune dead tokens (DeviceNotRegistered).
 *
 * A 24-hour TTL index automatically purges old tickets if they are never resolved.
 */
const PushTicketSchema = new Schema(
	{
		userId: { type: String, required: true, index: true },
		ticketId: { type: String, required: true },
		expoPushToken: { type: String, required: true },
		createdAt: { type: Date, default: Date.now },
	},
	{ collection: "pushTickets", versionKey: false },
);

PushTicketSchema.index({ ticketId: 1 }, { unique: true });
// Automatically purge tickets after 24 hours
PushTicketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export type PushTicketDocument = InferSchemaType<typeof PushTicketSchema> & { _id: unknown };

export const PushTicket = defineModel("PushTicket", PushTicketSchema);

