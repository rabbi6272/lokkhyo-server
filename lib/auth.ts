import type { DecodedIdToken } from "firebase-admin/auth";

import { connect } from "@/lib/db";
import { firebaseAuth } from "@/lib/firebase";
import { AppError, ErrorCode } from "@/lib/errors";
import { User, type UserDocument } from "@/models/user";

export interface AuthContext {
	/** The Firebase UID. This is the stable identity; the Mongo `_id` is not. */
	uid: string;
	user: UserDocument;
}

/**
 * Resolve the caller from a bearer token and return the request context.
 *
 * Verification is delegated entirely to the Firebase Admin SDK: it checks
 * signature, expiry, audience and issuer, which is not something to
 * reimplement. Nothing here trusts a client-supplied uid, email, or role.
 */
export async function authenticate(request: Request): Promise<AuthContext> {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer ")) {
		throw new AppError(
			ErrorCode.UNAUTHENTICATED,
			"Missing bearer token. Send the Firebase ID token as 'Authorization: Bearer <token>'.",
		);
	}

	const token = header.slice("Bearer ".length).trim();
	if (!token) {
		throw new AppError(ErrorCode.UNAUTHENTICATED, "Missing bearer token");
	}

	let decoded: DecodedIdToken;
	try {
		decoded = await firebaseAuth().verifyIdToken(token);
	} catch {
		// Deliberately vague: distinguishing "expired" from "forged" tells an
		// attacker which part of their token to fix.
		throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid or expired token");
	}

	await connect();

	// Provision on first sight with a single atomic upsert. A read-then-create
	// would race: two concurrent first requests would each see "no user" and
	// one would fail on the unique index.
	const user = await User.findOneAndUpdate(
		{ firebaseUid: decoded.uid },
		{
			$setOnInsert: {
				firebaseUid: decoded.uid,
				email: decoded.email ?? null,
				name: decoded.name ?? null,
				// Seeds the first write only, exactly like `name`: the provider's
				// picture is a starting value, not the current truth. Refreshing it
				// here would silently revert a photo the student uploaded with
				// `PUT /api/v1/me/photo` on their very next request.
				photoUrl: decoded.picture ?? null,
				role: "STUDENT",
				timezone: "Asia/Dhaka",
			},
			// Refresh the provider-owned fields on every sign-in without ever
			// overwriting anything the user set for themselves.
			$set: {
				email: decoded.email ?? undefined,
				lastLoginAt: new Date(),
			},
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	).lean<UserDocument>();

	if (!user) {
		throw new AppError(ErrorCode.INTERNAL_ERROR, "Failed to resolve user profile");
	}

	return { uid: decoded.uid, user: user as UserDocument };
}
