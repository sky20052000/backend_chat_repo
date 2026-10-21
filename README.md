# Chat Backend

Modular-monolith chat service built with Express, strict TypeScript, PostgreSQL (`pg` with parameterized SQL; no ORM), Firebase Firestore, and Socket.IO.

## Responsibilities

- `modules/auth`: verifies Firebase ID tokens for HTTP and Socket.IO.
- `modules/chats`: direct-chat application logic and PostgreSQL repository.
- `modules/messages`: Firestore message, read-receipt, and last-seen persistence.
- `modules/realtime`: authenticated chat room membership and socket message events.
- `infra`: PostgreSQL pool/migration, Firebase Admin SDK, and structured logging.

PostgreSQL stores Firebase UID-keyed users, chats, and memberships. User records should be created by the platform's user-registration workflow before chat creation. Firestore stores messages under `chats/{chatId}/messages`, read receipts under each message's `readReceipts` subcollection, and per-user last-seen documents under `lastSeen`. The PostgreSQL `messages` table is retained as a legacy migration source and is not used for normal message operations.

## Setup

1. Install Node.js 20 or later and PostgreSQL 14 or later.
2. Create a PostgreSQL database and copy `.env.example` to `.env`.
3. Configure `DATABASE_URL`, `FIREBASE_PROJECT_ID`, and Firebase credentials. For local development, put the service-account JSON at `secrets/firebase-service-account.json` and set `GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json`. The `secrets/` directory is git-ignored; never commit credential files. Enable the Cloud Firestore API and create a Firestore database in the Firebase project before using read receipts or last-seen.
4. Insert user records using the Firebase UID as `users.id`, for example:

   ```sql
   INSERT INTO users (id) VALUES ('firebase-uid-a'), ('firebase-uid-b');
   ```

5. Run `npm install`, `npm run build`, `npm run db:migrate`, and `npm run dev`.
6. `npm start` runs the compiled server.

Database migrations are plain SQL files under `src/infra/database/migrations`. The build copies them alongside the compiled migration runner. Apply them through `npm run db:migrate` after building. When moving an existing installation's PostgreSQL messages to Firestore, pause chat writes, run `npm run db:backfill-messages`, and only then deploy this version. The backfill preserves message IDs and timestamps, is safe to rerun, and stops on conflicting Firestore records rather than overwriting them. Keep writes paused through cutover so messages created during migration are not missed.

## Authentication and authorization

Send `Authorization: Bearer <Firebase ID token>` for every REST endpoint. Socket.IO clients pass the token as `auth: { token }`. A user's Firebase UID is the user ID used by this API. Client-provided sender/user IDs are checked against the authenticated UID, and every chat operation verifies membership. Chat creation requires the requester to be one of the two participants.

## REST API

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/chat/create` | `{ "userAId": "...", "userBId": "..." }` | `{ "chatId": "..." }` |
| `POST` | `/chat/:chatId/message/send` | `{ "senderId": "...", "text": "..." }` | `201 { "message": { ... } }` |
| `GET` | `/chat/:chatId/messages?limit=50&cursor=...` | Limit from 1–100 (default 50); pass `nextCursor` to fetch the next older page | `{ "messages": [...], "nextCursor": "..." }`, oldest-to-newest within each page |
| `POST` | `/chat/:chatId/message/:messageId/read` | `{ "userId": "..." }` | `204` |
| `POST` | `/chat/:chatId/lastseen` | `{ "userId": "...", "messageId": "..." }` | `204` |
| `GET` | `/user/:userId/chats` | — | `{ "chats": [...] }` |

`GET /health/live` is a liveness check. `GET /health/ready` also checks PostgreSQL connectivity.

## Socket.IO

- `chat:join` with `{ "chatId": "..." }` joins the room only after membership verification. Server acknowledges with `chat:joined`.
- `chat:send` with `{ "chatId": "...", "text": "..." }` uses the same message service as REST.
- `chat:message` broadcasts persisted messages to members in the room. REST message sends also emit this event.
- Invalid operations are returned to the originating socket as `chat:error`.

## Operational notes

- Set `CORS_ORIGINS` to the exact comma-separated frontend origins for each deployment.
- HTTP requests are protected by Helmet, JSON size limits, CORS, and a per-process rate limit. Use a shared rate-limit store when running multiple replicas.
- Keep Firebase credentials in a secret manager or workload identity in production. Never commit credentials.
- Messages are stored in Firestore with server-generated timestamps. Pagination uses an opaque Firestore timestamp/document-ID cursor so clients can fetch older messages without offset scans. Chat activity timestamps remain in PostgreSQL.
