import { Hono } from "hono";

import { created, noContent, okPage, parseBody, parseParams, readJson } from "@/lib/http";
import { pageRequestFromUrl } from "@/lib/pagination";
import { respond, respondPage } from "@/lib/serialize";
import { pageResponse } from "@/schemas/common";
import { deviceIdParams, deviceSchema, registerDeviceInput } from "@/schemas/notification";
import { deleteDevice, listDevices, registerDevice } from "@/services/notification";
import { authMiddleware } from "@/src/middleware/auth";
import type { AppEnv } from "@/src/types";

export const devicesRouter = new Hono<AppEnv>();

devicesRouter.use("*", authMiddleware);

const devicePage = pageResponse(deviceSchema);

devicesRouter.get("/", async (c) => {
	const auth = c.get("auth");
	const url = new URL(c.req.url);
	const page = await listDevices(auth.uid, pageRequestFromUrl(url));
	return okPage(respondPage(devicePage, page));
});

devicesRouter.post("/", async (c) => {
	const auth = c.get("auth");
	const input = parseBody(registerDeviceInput, await readJson(c.req.raw));
	return created(respond(deviceSchema, await registerDevice(auth.uid, input)));
});

devicesRouter.delete("/:id", async (c) => {
	const auth = c.get("auth");
	const { id } = parseParams(deviceIdParams, { id: c.req.param("id") });
	await deleteDevice(auth.uid, id);
	return noContent();
});

