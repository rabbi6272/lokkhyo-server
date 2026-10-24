# Lokkhyo Server — Endpoint Reference

This document is the canonical reference for all REST API endpoints implemented in `lokkhyo-server`.

All student-scoped paths are resolved from the Bearer ID token (`/me`, `/courses`, etc.). No student ID is accepted from the client.

## Response Envelope

- **Success:** `{ "data": { ... } }` or `{ "data": [ ... ], "pagination": { "nextCursor": "...", "hasMore": true, "limit": 20 } }`
- **Error:** `{ "error": { "code": "ERROR_CODE", "message": "...", "details": { ... } } }`

---

## Endpoint Inventory

### Public / System
- `GET /health` — Service health check
- `GET /grading-scale` — RUET/BUET grading scale, classification boundaries, and grade bands

### Student Profile & Settings
- `GET /me` — Get authenticated student profile (upserts on first request)
- `PATCH /me` — Update student profile (name, university, department, target CGPA, timezone)
- `DELETE /me` — Delete student account and cascade-delete all associated data
- `PUT /me/photo` — Upload/update profile photo (Cloudinary + sharp)
- `DELETE /me/photo` — Remove profile photo
- `GET /me/cgpa` — Get stored cumulative GPA summary (`totalWeightedPoints`, `totalCredits`)
- `GET /me/gpa` — Get semester GPA breakdown
- `GET /me/transcript` — Full academic transcript and degree status
- `GET /me/degree-status` — Degree status and credit completion check
- `GET /me/routine` — Current routine summary
- `GET /me/routine/week` — Full weekly routine grid (Sat–Fri)
- `GET /me/notification-prefs` — Get notification preferences
- `PATCH /me/notification-prefs` — Update notification preferences and category toggles

### Semesters
- `GET /semesters` — List semesters (cursor pagination)
- `POST /semesters` — Create a semester
- `GET /semesters/:id` — Get semester details
- `PATCH /semesters/:id` — Update semester
- `DELETE /semesters/:id` — Delete semester
- `POST /semesters/:id/activate` — Set semester as active

### Courses
- `GET /courses` — List courses in active/specified semester
- `POST /courses` — Create a course
- `GET /courses/:id` — Get course details
- `PATCH /courses/:id` — Update course
- `DELETE /courses/:id` — Delete course
- `PUT /courses/:id/routine` — Set/update weekly routine slots for a course
- `GET /courses/:id/routine` — Get routine slots for a course
- `PUT /courses/:id/attendance` — Mark or update attendance for a class session `(date, slotId)`
- `GET /courses/:id/attendance` — List attendance sessions for a course
- `GET /courses/:id/attendance/summary` — Attendance statistics, eligibility (≥ 50%), and warning (≥ 60%)

### Attendance (Global)
- `GET /attendance/:id` — Get specific attendance session

### Assessments (Coursework)
- `GET /assessments` — List assessments (CT, quiz, assignment, lab)
- `POST /assessments` — Create assessment
- `GET /assessments/:id` — Get assessment
- `PATCH /assessments/:id` — Update assessment
- `DELETE /assessments/:id` — Delete assessment

### Results (Official Grades)
- `GET /results` — List official results
- `POST /results` — Record official result (requires `Idempotency-Key` header, 7-day TTL)
- `GET /results/:id` — Get result

### Deadlines / Reminders
- `GET /deadlines` — List upcoming deadlines / reminders
- `POST /deadlines` — Create deadline
- `GET /deadlines/:id` — Get deadline
- `PATCH /deadlines/:id` — Update deadline
- `DELETE /deadlines/:id` — Delete deadline

#### Deadline Data Model & Reminder State
Each deadline stores its reminder configuration and atomic delivery ledger:
```json
{
  "_id": "65f1c0ffee00000000000099",
  "userId": "Xk2fQ9aB7cD1eF3gH5iJ7kL9mN0p",
  "type": "ASSESSMENT",
  "assessmentType": "CT",
  "courseId": "65f1c0ffee00000000000001",
  "assessmentId": null,
  "title": "CT 2 - Algorithm Design",
  "dueAt": "2026-10-25T10:00:00.000Z",
  "reminderLeadTimes": [72, 24],
  "remindersSent": [
    {
      "leadTimeHours": 72,
      "sentAt": "2026-10-22T10:00:00.000Z"
    }
  ],
  "createdAt": "2026-10-20T08:00:00.000Z",
  "updatedAt": "2026-10-22T10:00:00.000Z"
}
```
- `reminderLeadTimes`: Offsets in hours before `dueAt` when the student should be reminded (default: `[72, 24]`).
- `remindersSent`: Atomic record of fired lead times `{ leadTimeHours, sentAt }`. During dispatch, `claimReminder()` executes an atomic conditional update (`"remindersSent.leadTimeHours": { $ne: leadTimeHours }`) to prevent duplicate pushes across concurrent scheduler runs.
- `categoriesEnabled.DEADLINE`: Gated by user notification preference.

### Notifications (Inbox)
- `GET /notifications` — Get in-app notification inbox (supports `category`, `unreadOnly`, cursors)
- `POST /notifications/read` — Mark notifications as read (supports specific ids or `"all"`)

### Devices & Push
- `GET /devices` — List registered devices
- `POST /devices` — Register/update device token (`expoPushToken` and/or `fcmToken`, `platform`, `pushProvider`)
- `DELETE /devices/:id` — Unregister device

#### Device Registration & Expo Push Transport
```json
{
  "_id": "65f1c0ffee00000000000088",
  "userId": "Xk2fQ9aB7cD1eF3gH5iJ7kL9mN0p",
  "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "fcmToken": null,
  "pushProvider": "EXPO",
  "platform": "ANDROID",
  "deviceName": "android 34",
  "lastSeenAt": "2026-10-24T00:00:00.000Z"
}
```
- **Push Delivery:** Pushes are sent to Expo's Push Service (`POST https://exp.host/--/api/v2/push/send`) in chunks of ≤ 100 with optional fallback to legacy FCM multicast.
- **Receipt Tracking & Pruning:** Accepted tickets are persisted in `pushTickets` (TTL 24 hours). Every dispatch run queries `POST https://exp.host/--/api/v2/push/getReceipts` for tickets older than 15 minutes, automatically pruning dead tokens (`DeviceNotRegistered`) and purging resolved tickets. Devices inactive for > 90 days are pruned automatically.

### Internal (Cron / Dispatch)
- `GET /internal/dispatch` — Trigger background dispatch runner (requires `Authorization: Bearer <CRON_SECRET>`)
- `POST /internal/dispatch` — Trigger background dispatch runner (requires `Authorization: Bearer <CRON_SECRET>`)

---

## Server Runtime Options

The server can run in two modes:

### 1. Hono on Bun (Production Target)
- High-performance, portable API runtime built with Hono and served directly by Bun.
- Verified with Docker (`Dockerfile`) and Render (`render.yaml`).
- Run commands:
  ```bash
  bun run dev:hono    # Local development with hot reload
  bun run start:hono  # Production boot (src/index.ts)
  ```

### 2. Next.js (Dual-Run / Backward-Compatibility)
- Existing Next.js route handlers (`app/api/v1/**`).
- Run commands:
  ```bash
  bun run dev         # Next.js development server
  bun run start       # Next.js production server
  ```

