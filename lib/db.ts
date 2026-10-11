import mongoose from "mongoose";

type MongooseCache = {
	connection?: Promise<typeof mongoose>;
	shutdownRegistered?: boolean;
};

const globalForMongoose = globalThis as typeof globalThis & MongooseCache;

/**
 * MongoDB has no `migrate` command in the Prisma sense and no referential
 * actions, so the schema in `models/` is the source of truth and indexes are
 * declared there. Mongoose builds them idempotently on connect.
 *
 * The connection is created lazily and memoised on globalThis so that Next.js
 * hot reloads in development do not open a new pool per module evaluation.
 */
export async function connect(): Promise<typeof mongoose> {
	if (globalForMongoose.connection) {
		return globalForMongoose.connection;
	}

	// Read inside the function rather than at module scope. Throwing on import
	// would make `next build` require a live DATABASE_URL, so a build could not
	// run in an environment that has no secret configured — and a route module
	// that merely imports this file would fail to compile.
	const uri = process.env.DATABASE_URL;
	if (!uri) {
		throw new Error("DATABASE_URL environment variable is required");
	}

	const connection = mongoose
		.connect(uri, {
			// Fail fast instead of buffering a request for 10s when the cluster
			// is unreachable; a 500 the user can retry beats a hung socket.
			bufferCommands: false,
			serverSelectionTimeoutMS: 5_000,
		})
		.catch((error: unknown) => {
			// Clear the memo so a later request can retry the connection rather
			// than replaying this rejection forever.
			delete globalForMongoose.connection;
			throw error;
		});

	// Swallow the rejection on the memoised promise itself. Without this,
	// Node treats it as an unhandled rejection and kills the process the first
	// time a request arrives while the cluster is down.
	connection.catch(() => undefined);

	globalForMongoose.connection = connection;
	registerShutdownHandlers();
	return connection;
}

export async function disconnect(): Promise<void> {
	const connection = globalForMongoose.connection;
	if (!connection) {
		return;
	}
	delete globalForMongoose.connection;
	await (await connection).disconnect();
}

export { mongoose };

/**
 * Close the pool on shutdown so a redeploy does not leave sockets dangling
 * against the cluster.
 *
 * Registered on first connect, not at import. This module is imported by every
 * route, and `next build` evaluates those modules in workers that never open a
 * connection — a handler registered at import would attach to all of them and
 * print shutdown noise for pools that never existed. Registering once a
 * connection exists also means the guard and the connection share a lifetime,
 * so there is no window where a signal arrives with no handler installed.
 */
function registerShutdownHandlers(): void {
	if (globalForMongoose.shutdownRegistered) {
		return;
	}

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			void disconnect().finally(() => {
				process.exit(0);
			});
		});
	}
	globalForMongoose.shutdownRegistered = true;
}
