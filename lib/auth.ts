import { createRemoteJWKSet, jwtVerify } from "jose";

import { connect } from "@/lib/db";
import { firebaseAuth } from "@/lib/firebase";
import { AppError, ErrorCode } from "@/lib/errors";
import { User, type UserDocument } from "@/models/user";

export interface AuthContext {
	/** The Firebase UID. This is the stable identity; the Mongo `_id` is not. */
	uid: string;
	user: UserDocument;
}

export interface DecodedToken {
	uid: string;
	email?: string;
	name?: string | null;
	picture?: string | null;
}

const GOOGLE_JWKS_URL = new URL(
	"https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);
const JWKS = createRemoteJWKSet(GOOGLE_JWKS_URL);

export function getFirebaseProjectId(): string {
	if (process.env.FIREBASE_PROJECT_ID) {
		return process.env.FIREBASE_PROJECT_ID;
	}
	if (process.env.FIREBASE_SERVICE_ACCOUNT) {
		try {
			const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
			if (parsed.project_id) return parsed.project_id;
		} catch {}
	}
	return "lokkhyo-app";
}

/**
 * Verify a Firebase ID token.
 * Uses lightweight `jose` with remote JWKS caching by default, with automatic
 * `firebase-admin` fallback.
 */
export async function verifyToken(token: string): Promise<DecodedToken> {
	if (process.env.AUTH_VERIFIER === "firebase_admin") {
		try {
			const decoded = await firebaseAuth().verifyIdToken(token);
			return {
				uid: decoded.uid,
				email: decoded.email,
				name: decoded.name ?? null,
				picture: decoded.picture ?? null,
			};
		} catch {
			throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid or expired token");
		}
	}

	const projectId = getFirebaseProjectId();
	try {
		const { payload } = await jwtVerify(token, JWKS, {
			issuer: `https://securetoken.google.com/${projectId}`,
			audience: projectId,
		});

		if (!payload.sub) {
			throw new Error("Missing subject (uid) in token");
		}

		return {
			uid: payload.sub,
			email: typeof payload.email === "string" ? payload.email : undefined,
			name: typeof payload.name === "string" ? payload.name : null,
			picture: typeof payload.picture === "string" ? payload.picture : null,
		};
	} catch {
		// Fallback to Firebase Admin SDK if available
		try {
			const decoded = await firebaseAuth().verifyIdToken(token);
			return {
				uid: decoded.uid,
				email: decoded.email,
				name: decoded.name ?? null,
				picture: decoded.picture ?? null,
			};
		} catch {
			throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid or expired token");
		}
	}
}

/**
 * Resolve the caller from a bearer token and return the request context.
 * Nothing here trusts a client-supplied uid, email, or role.
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

	const decoded = await verifyToken(token);

	await connect();

	// Provision on first sight with a single atomic upsert. A read-then-create
	// would race: two concurrent first requests would each see "no user" and
	// one would fail on the unique index.
	const user = await User.findOneAndUpdate(
		{ firebaseUid: decoded.uid },
		{
			$setOnInsert: {
				firebaseUid: decoded.uid,
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
		{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
	).lean<UserDocument>();

	if (!user) {
		throw new AppError(ErrorCode.INTERNAL_ERROR, "Failed to resolve user profile");
	}

	return { uid: decoded.uid, user: user as UserDocument };
}
