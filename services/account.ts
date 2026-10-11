import { connect } from "@/lib/db";
import { dropProfilePhoto } from "@/lib/cloudinary";
import {
	Assessment,
	Attendance,
	Course,
	Deadline,
	Device,
	GpaRecord,
	Notification,
	NotificationPrefs,
	PushClaim,
	Result,
	Routine,
	Semester,
	User,
} from "@/models";

/**
 * Erase everything the student owns.
 *
 * Mongo has no referential actions, so the purge is written out collection by
 * collection; a collection missing from this list would survive the account.
 * Idempotency claims are not listed: they carry no academic data and expire on
 * their own TTL.
 *
 * The photo goes first. If storage is unreachable the request fails before any
 * record is touched, so a retry can finish the job — whereas deleting the
 * profile first would lose the only pointer to an asset that then lingers.
 * Firebase owns the credential, so the client deletes the Firebase user after
 * this returns.
 */
export async function deleteAccount(userId: string, photoUrl: string | null): Promise<void> {
	await connect();

	if (photoUrl?.includes("res.cloudinary.com")) {
		await dropProfilePhoto(userId);
	}

	await Promise.all([
		Attendance.deleteMany({ userId }),
		Result.deleteMany({ userId }),
		GpaRecord.deleteMany({ userId }),
		Assessment.deleteMany({ userId }),
		Deadline.deleteMany({ userId }),
		Routine.deleteMany({ userId }),
		Course.deleteMany({ userId }),
		Semester.deleteMany({ userId }),
		Device.deleteMany({ userId }),
		Notification.deleteMany({ userId }),
		NotificationPrefs.deleteMany({ userId }),
		PushClaim.deleteMany({ userId }),
	]);

	// Last, so a partial failure above leaves a profile the next request can
	// authenticate against and retry the purge from.
	await User.deleteOne({ firebaseUid: userId });
}
