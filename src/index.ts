import { connect } from "@/lib/db";
import { app } from "@/src/app";

const port = Number(process.env.PORT) || 3000;

// Connect to MongoDB on server boot. `connect` also installs the SIGTERM/SIGINT
// handler that closes the pool, so Render redeploys shut down cleanly.
await connect().catch((err) => {
	console.error("Failed to connect to database on startup:", err);
});

console.log(`Lokkhyo server (Hono on Bun) listening on port ${port}`);

export default {
	port,
	fetch: app.fetch,
	// Bun closes sockets idle for 10s by default; a dispatch run over many users
	// can take longer than that, and cron-job.org would see a dropped connection.
	idleTimeout: 120,
};
