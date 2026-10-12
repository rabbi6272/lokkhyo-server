import { describe, expect, it } from "vitest";

import { NotificationPrefs } from "@/models/notification";
import { notificationPrefsSchema, updateNotificationPrefsInput } from "@/schemas/user";

/**
 * Contract tests for notification preferences.
 *
 * `respond()` parses every response against `notificationPrefsSchema` and throws
 * rather than degrading, so a field the model forgets to default is a 500 for
 * every student whose row predates the field — not a null that goes unnoticed.
 * These assert the default survives hydration, which is the path
 * `getNotificationPrefs` takes when it reads an old row.
 */
describe("notification prefs", () => {
	it("defaults the assessment reminder time for a row written before it existed", () => {
		// The exact shape of a document saved before this release: no
		// assessmentReminderTime, and only two of the five categories set.
		const legacy = NotificationPrefs.hydrate({
			_id: "65f1c0ffee0000000000abcd",
			userId: "Xk2fQ9aB7cD1eF3gH5iJ7kL9mN0p",
			timezone: "Asia/Dhaka",
			morningRoutineTime: "07:00",
			eveningAttendanceTime: "19:00",
			categoriesEnabled: { ROUTINE: true, ATTENDANCE: true },
			attendanceCutoffHour: 20,
		});

		const parsed = notificationPrefsSchema.parse(legacy.toObject());
		expect(parsed.assessmentReminderTime).toBe("07:00");
		// A patch to one time must not disturb the others.
		expect(parsed.eveningAttendanceTime).toBe("19:00");
		expect(parsed.morningRoutineTime).toBe("07:00");
	});

	it("accepts an assessment reminder time without mentioning the other times", () => {
		const input = updateNotificationPrefsInput.parse({ assessmentReminderTime: "06:45" });
		expect(input).toEqual({ assessmentReminderTime: "06:45" });
		expect(input.morningRoutineTime).toBeUndefined();
		expect(input.categoriesEnabled).toBeUndefined();
	});

	it("rejects a time that is not 24-hour HH:mm", () => {
		expect(() => updateNotificationPrefsInput.parse({ assessmentReminderTime: "25:00" })).toThrow();
		expect(() => updateNotificationPrefsInput.parse({ assessmentReminderTime: "7:00" })).toThrow();
		expect(() => updateNotificationPrefsInput.parse({ assessmentReminderTime: "0700" })).toThrow();
		expect(() => updateNotificationPrefsInput.parse({ assessmentReminderTime: "07:60" })).toThrow();
	});

	it("rejects unknown keys, so an app built against a newer server cannot half-apply", () => {
		// The update input is a strictObject: an app PATCHing a field this
		// server does not know about must fail loudly instead of silently
		// dropping it, which is why the server ships before the app.
		expect(() => updateNotificationPrefsInput.parse({ afternoonDigestTime: "15:00" })).toThrow();
	});
});
