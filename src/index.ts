import { connect, disconnect } from "@/lib/db";
import { app } from "@/src/app";

const port = Number(process.env.PORT) || 3000;

// Connect to MongoDB on server boot
await connect().catch((err) => {
	console.error("Failed to connect to database on startup:", err);
});

console.log(`Lokkhyo server (Hono on Bun) listening on port ${port}`);

// Graceful shutdown
const shutdown = async () => {
	console.log("Shutting down Lokkhyo server...");
	await disconnect().catch(() => {});
	process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default {
	port,
	fetch: app.fetch,
};

