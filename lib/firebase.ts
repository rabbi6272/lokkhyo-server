import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";

/**
 * Firebase Admin is initialised lazily and only once per process. Next.js
 * re-evaluates modules on hot reload, and `initializeApp` throws if called
 * twice against the same project.
 */
function app() {
	if (getApps().length > 0) {
		return getApps()[0];
	}

	const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
	if (serviceAccount) {
		// Supplied as a single JSON string so the whole credential can live in
		// one env var, which is what most hosts make easy to set.
		const parsed = JSON.parse(serviceAccount) as {
			project_id: string;
			client_email: string;
			private_key: string;
		};
		return initializeApp({
			credential: cert({
				projectId: parsed.project_id,
				clientEmail: parsed.client_email,
				// Env vars cannot hold real newlines; the PEM arrives escaped.
				privateKey: parsed.private_key.replace(/\\n/g, "\n"),
			}),
		});
	}

	// Falls back to GOOGLE_APPLICATION_CREDENTIALS / workload identity, which
	// is how this runs when hosted somewhere that issues ambient credentials.
	return initializeApp({ credential: applicationDefault() });
}

export function firebaseAuth() {
	return getAuth(app());
}

export function firebaseMessaging() {
	return getMessaging(app());
}
