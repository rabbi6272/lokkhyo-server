import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { app } from "@/src/app";
import { gradingScaleDto } from "@/lib/grading";
import * as authLib from "@/lib/auth";
import * as dispatchService from "@/services/dispatch";

describe("Hono application (src/app.ts)", () => {
	it("responds to container health check on /health", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ status: "healthy" });
	});

	it("responds to /api/v1/health in API envelope", async () => {
		const res = await app.request("/api/v1/health");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ data: { status: "healthy" } });
	});

	it("rejects unauthenticated requests to /api/v1/grading-scale with 401", async () => {
		const res = await app.request("/api/v1/grading-scale");
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error).toBeDefined();
		expect(json.error.code).toBe("UNAUTHENTICATED");
	});

	it("rejects unauthenticated requests to /api/v1/me with 401", async () => {
		const res = await app.request("/api/v1/me");
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe("UNAUTHENTICATED");
	});

	it("rejects unauthenticated requests to /api/v1/courses with 401", async () => {
		const res = await app.request("/api/v1/courses");
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe("UNAUTHENTICATED");
	});

	it("rejects unauthenticated requests to /api/v1/semesters with 401", async () => {
		const res = await app.request("/api/v1/semesters");
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe("UNAUTHENTICATED");
	});

	it("serves /api/v1/grading-scale when authenticated", async () => {
		vi.spyOn(authLib, "authenticate").mockResolvedValueOnce({
			uid: "test-user-123",
			user: {
				firebaseUid: "test-user-123",
				name: "Test Student",
				timezone: "Asia/Dhaka",
				role: "STUDENT",
			} as any,
		});

		const res = await app.request("/api/v1/grading-scale", {
			headers: { authorization: "Bearer valid-mock-token" },
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data).toBeDefined();
		expect(json.data.scale).toBeDefined();
		expect(json.data.degreeCgpaThreshold).toBe(2.2);
		expect(json.data.classificationBoundaries).toBeDefined();
		expect(json.data.scale.length).toBe(gradingScaleDto().scale.length);
	});

	it("rejects unauthenticated requests to /api/v1/internal/dispatch when secret is wrong", async () => {
		process.env.CRON_SECRET = "super-secret-key-123";
		const res = await app.request("/api/v1/internal/dispatch", {
			headers: { authorization: "Bearer wrong-secret" },
		});
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe("UNAUTHENTICATED");
	});

	it("executes /api/v1/internal/dispatch when CRON_SECRET matches", async () => {
		process.env.CRON_SECRET = "super-secret-key-123";
		const dispatchSpy = vi.spyOn(dispatchService, "runDispatch").mockResolvedValueOnce({
			usersChecked: 5,
			sent: 3,
			failures: 0,
		});

		const res = await app.request("/api/v1/internal/dispatch", {
			method: "POST",
			headers: { authorization: "Bearer super-secret-key-123" },
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data).toEqual({ usersChecked: 5, sent: 3, failures: 0 });
		expect(dispatchSpy).toHaveBeenCalled();
	});

	it("refuses /api/v1/internal/dispatch when CRON_SECRET is not configured", async () => {
		const prev = process.env.CRON_SECRET;
		delete process.env.CRON_SECRET;
		try {
			const res = await app.request("/api/v1/internal/dispatch", {
				headers: { authorization: "Bearer some-key" },
			});
			expect(res.status).toBe(500);
			const json = await res.json();
			expect(json.error.code).toBe("INTERNAL_ERROR");
		} finally {
			process.env.CRON_SECRET = prev;
		}
	});
});

