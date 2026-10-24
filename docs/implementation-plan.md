# Implementation Plan

Phased so each phase ends with something runnable and testable. See [architecture.md](./architecture.md) for the design behind each step.

## Phase 0 — Project Setup

- [x] `git init`, `.gitignore` (`node_modules`, `.env`, `dist`)
- [ ] npm workspace with `packages/server`, `packages/web`, `packages/shared`
- [ ] TypeScript configs (base `tsconfig.base.json` + per-package extends — shared strict settings at the root, `module`/`moduleResolution`/target per-package since `server` and `web` need different resolution)
- [ ] `npm install express cookie-parser cors zod jsonwebtoken bcrypt -w packages/server`, dev: `@types/express @types/cookie-parser @types/cors @types/jsonwebtoken @types/bcrypt`
- [ ] Prisma, pinned to an exact version from the first install — check `npm view prisma dist-tags` first and confirm `latest` actually points at a stable release before trusting it: `npm install --save-exact prisma@<version> @prisma/client@<version> -w packages/server`
- [ ] ESLint (or oxlint) + Prettier at the repo root
- [ ] Postgres + Redis via Docker Compose (named volume on Postgres only — Redis holds no durable state)
- [ ] Prisma initialized, connected to local Postgres, wrapped in a one-line exported singleton (`db.ts`: `export const prisma = new PrismaClient({ adapter })`)
- [ ] `env.ts`: Zod schema against `process.env`, validated once at startup, throws immediately with a clear message if anything required is missing

**Done when:** `docker compose up`, `prisma migrate dev` run clean, a bare Express app (`GET /health` → `200`) boots and responds.

## Phase 1 — Data Layer & Core Task API

- [ ] Prisma schema for `users`, `tasks`, `comments`, plus `TaskStatus`/`TaskVisibility` enums (architecture.md §5)
- [ ] First migration
- [ ] `shared` package: plain TS interfaces for `Task`, `Comment`, request/response bodies, a generic `PaginatedResponse<T>`
- [ ] `auth.ts`: register/login/logout route handlers, password hashing, JWT issuing — one file
- [ ] `middleware.ts`: `requireAuth` (401 if no valid token), `optionalAuth` (attaches `req.user` if present, never rejects)
- [ ] `tasks.ts`: task route handlers, plus `canAccessTask(task, userId)` exported for reuse (architecture.md §8)
- [ ] Tests, written before the implementation for anything with real logic: `canAccessTask` gets a spec first, covering the full owner/stranger/anonymous × public/private matrix; `auth.ts`'s register/login logic gets a spec with a mocked Prisma client

**Done when:** a user can register, log in, create a task, and a second user can see it only if it's public — verified with `supertest` against the real `app`, not just unit-level mocks.

## Phase 2 — Comments API (no real-time yet)

- [ ] `comments.ts`: `GET /tasks/:id/comments` (paginated), `POST /tasks/:id/comments`, importing `canAccessTask` from `tasks.ts` rather than reimplementing the check
- [ ] Zod schemas for the request body/query, parsed at the top of each handler
- [ ] Rate limiting on comment creation (`express-rate-limit`, in-memory store for now — Redis-backed once Redis exists in Phase 3)
- [ ] Offset pagination (`skip`/`take`), not cursor-based — a single task's comment list won't hit deep-pagination performance problems at this scale; cursor pagination is the known upgrade path, not needed now
- [ ] Tests: pagination math (page/limit → skip/take, scoped to one task) gets a spec first; integration tests for commenting on someone else's public task (succeeds) vs. private task (403s)

**Done when:** comments persist and are readable via REST, with no live updates yet — confirms the data layer is solid before real-time complexity.

## Phase 3 — Real-Time Layer

- [ ] Two `ioredis` clients (pub, sub — a connection in subscribe mode can't issue other commands)
- [ ] `realtime.ts`: `new Server(httpServer, {...})`, `io.adapter(createAdapter(pubClient, subClient))`, wired in `index.ts` before `httpServer.listen()`
- [ ] Socket auth middleware (`io.use(...)`, architecture.md §6.3) — same cookie REST routes use, verified directly with `jsonwebtoken`
- [ ] `join:task`/`leave:task` handlers calling `canAccessTask` — imported from `tasks.ts`, not reimplemented
- [ ] On comment creation: insert via Prisma, then `server.to('task:{taskId}').emit('comment:new', comment)` — the Redis adapter handles cross-instance delivery, no manual bridge code
- [ ] Manual multi-instance test: two server instances on different ports against the same Redis + Postgres, confirm a comment posted via instance A's REST API appears on a client connected to instance B's WebSocket
- [ ] Confirm Redis auth: connecting without the password fails

**Done when:** two browser tabs, each connected to a (possibly different) server instance, both see a new comment on a public task appear without refreshing.

## Phase 4 — Frontend

- [ ] React + Vite scaffold
- [ ] Auth pages: register/login
- [ ] Task list (mine + public), task detail view
- [ ] Comment thread: initial load via REST, live updates via Socket.IO client, optimistic append on send
- [ ] Public task view reachable without login (read-only comments; login prompt to post)

**Done when:** a logged-out visitor can open a public task's URL and watch comments arrive live as other users post them.

## Phase 5 — Hardening & Deploy Prep

- [ ] Structured logging (`pino`)
- [ ] Error-handling middleware (`(err, req, res, next)`, 4-arg signature) returning consistent JSON error shapes
- [ ] `env.ts`'s startup validation extended to cover everything needed by this point
- [ ] `express-rate-limit`'s store switched to Redis-backed, so the limit holds globally across instances, not per-instance
- [ ] Dockerfile for the server; confirm it runs against non-local Postgres and Redis
- [ ] Basic CI: typecheck, lint, test on push
- [ ] Load-test the comment broadcast path to confirm the Redis adapter delivers to all instances under expected concurrent-viewer counts

**Done when:** the app can be deployed to a single environment end-to-end and survives a restart of one Node instance without dropping the other instance's connections.

## Open Decisions to Confirm Before Starting

- Hosting target (affects Phase 5 specifics): a single VM/container host, or a PaaS?
- Is task editing/deletion by non-owners (shared collaborators) needed for v1, or is owner-only sufficient?
- Should comments be editable/deletable in v1, or append-only?
- Test database strategy for integration tests — a separate `*_test` database with table-clearing between tests is the simple, low-setup default; confirm before Phase 1's integration tests are written.
- Stretch goal, not scoped into a phase above: Redis Streams instead of pub/sub, for at-least-once delivery and replay-on-reconnect.
