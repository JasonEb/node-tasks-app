# Architecture

## 1. Overview

A task management app. Users create tasks, mark them public or private, and discuss them through comments. Comments on public tasks appear live to everyone currently viewing that task, without a page refresh.

**Core requirement:** real-time comment delivery to multiple concurrent viewers of a public task, built on plain TypeScript and Node — Express for HTTP, nothing framework-shaped layered on top of it. Every request's path from route to response is a function call you can read top to bottom, not a graph of decorators and dependency injection resolved at runtime.

## 2. Assumptions

Flag any that don't match intent:

- Viewing a public task requires no authentication; posting a comment does (comments are attributed to a user).
- "Public" vs "private" is a per-task flag set by the task's owner. Private tasks are visible only to their owner (no sharing/collaborators in v1).
- Single Postgres instance (no read replicas) for v1. The app may run multiple Node instances behind a load balancer.
- Web client only for v1 (no native mobile), but the API is transport-agnostic enough to support one later.

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict mode) | end-to-end type safety, shared types between server/client |
| Runtime | Node.js (LTS) | required by the brief |
| HTTP | Express | minimal routing/middleware — a request handler function and a way to compose middleware, nothing more opinionated than that |
| Validation | Zod | `schema.parse(req.body)` at the top of a handler, call it a day — no decorators, no class instances, no separate validation pipeline to configure |
| Database | PostgreSQL | required by the brief |
| ORM | Prisma | migrations, type-safe queries, a single exported client instance |
| Real-time transport | Socket.IO, on the same `http.Server` Express listens on | room-based broadcast maps cleanly to "per-task" subscriptions |
| Real-time fan-out across instances | Redis (pub/sub) via `@socket.io/redis-adapter` + `ioredis` | Socket.IO rooms are per-instance by default; this makes `server.to(room).emit(...)` reach every instance, not just the one that handled the request |
| Auth | JWT in an httpOnly cookie, signed/verified directly with `jsonwebtoken` | stateless, works for both HTTP requests and the WebSocket handshake |
| Frontend | React + Vite | separate concern from the backend entirely |

## 4. System Components

```
                    ┌─────────────┐
                    │   Browser    │
                    │ (React app)  │
                    └──────┬───────┘
                HTTP  ▲    │    ▲  WebSocket
                      │    │    │
              ┌───────┴────┴────┴────────┐
              │     Load Balancer         │
              └───────────┬───────────────┘
                 ┌─────────┴─────────┐
                 │                   │
          ┌──────┴──────┐     ┌──────┴──────┐
          │ Node Instance│     │ Node Instance│   (horizontally scalable)
          │  Express     │     │  Express     │
          │  Socket.IO   │     │  Socket.IO   │
          └──────┬──┬────┘     └────┬──┬──────┘
                 │  │  pub/sub      │  │
                 │  └───────┬───────┘  │
                 │     ┌────┴────┐     │
                 │     │  Redis   │    │
                 │     │ pub/sub  │    │
                 │     └─────────┘     │
                 │                     │
                 └──────────┬──────────┘
                      SQL reads/writes
                    ┌──────┴───────┐
                    │  PostgreSQL   │
                    │ tasks, users, │
                    │ comments      │
                    └───────────────┘
```

Each Node instance runs one Express app and one Socket.IO server on the same underlying `http.Server`. Redis carries only the live fan-out signal; it holds no durable data — Postgres is the only system of record.

## 5. Data Model

```
users
  id            uuid PK
  email         text unique not null
  password_hash text not null
  name          text not null
  created_at    timestamptz not null default now()

tasks
  id          uuid PK
  owner_id    uuid FK -> users.id on delete restrict
  title       text not null
  description text
  status      task_status enum ('todo','in_progress','done') not null default 'todo'
  visibility  task_visibility enum ('public','private') not null default 'private'
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()

comments
  id          uuid PK
  task_id     uuid FK -> tasks.id on delete cascade
  author_id   uuid FK -> users.id on delete set null, nullable
  body        text not null
  created_at  timestamptz not null default now()
```

Indexes: `tasks(owner_id)`, `tasks(visibility)`, `comments(task_id, created_at)`.

`status`/`visibility` are native Postgres enum types (Prisma `enum TaskStatus { todo in_progress done }` / `enum TaskVisibility { public private }`) — the column itself rejects an invalid value, enforced by Postgres regardless of what wrote to it. Zod validation at the request boundary still matters on top of this: the enum is the hard guarantee; Zod is what turns a bad request into a clean `400` instead of a raw constraint-violation error reaching the client.

`tasks.owner_id` is `ON DELETE RESTRICT` — deleting a user fails while they still own tasks, since cascading would silently destroy other people's comments on those tasks too. `comments.author_id` is `ON DELETE SET NULL` and nullable — deleting a user detaches their comments rather than deleting them or blocking the deletion; `RESTRICT` there would make account deletion nearly impossible once someone's commented anywhere.

## 6. Real-Time Design

### 6.1 Wiring

```ts
const app = express();
// ... middleware, routes ...

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: webOrigin, credentials: true } });
io.adapter(createAdapter(pubClient, subClient));

httpServer.listen(port);
```

One HTTP server, two things attached to it: Express handles plain requests, Socket.IO handles upgraded WebSocket connections. `app` itself is just a request-handler function Socket.IO happens to share a port with — there's no separate "web server" and "socket server" running independently.

### 6.2 Why Redis pub/sub

Socket.IO rooms are per-instance: a client connected to instance A never sees `server.to(room).emit(...)` called on instance B. The Redis adapter publishes every emit to a channel every instance subscribes to, and each re-emits locally to its own connected clients.

**Trade-off accepted:** Redis pub/sub is fire-and-forget — a message published while an instance is briefly down is lost, no replay. Acceptable here because `GET /tasks/:id/comments` is the durable source of truth; a reconnecting client re-fetches it, so a missed live event is a brief delay, not lost data.

### 6.3 Auth on the socket connection

```ts
io.use((socket, next) => {
  const token = parseCookie(socket.handshake.headers.cookie)?.['access_token'];
  if (!token) { socket.data.user = null; return next(); } // anonymous allowed
  try {
    socket.data.user = jwt.verify(token, process.env.JWT_SECRET!) as { id: string; email: string };
  } catch {
    socket.data.user = null;
  }
  next();
});
```

`join:task` inside the connection handler calls the same task-visibility check the REST routes use (§8) — one function, not a parallel reimplementation for sockets.

## 7. API Design (REST)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none | create account |
| POST | `/auth/login` | none | issue JWT cookie |
| POST | `/auth/logout` | session | clear cookie |
| GET | `/tasks` | optional | list caller's tasks + public tasks |
| POST | `/tasks` | required | create task |
| GET | `/tasks/:id` | optional | fetch one task (403 if private and not owner) |
| PATCH | `/tasks/:id` | owner | update task |
| DELETE | `/tasks/:id` | owner | delete task |
| GET | `/tasks/:id/comments` | optional | paginated comment history |
| POST | `/tasks/:id/comments` | required | create comment (triggers broadcast) |

WebSocket events: `join:task`, `leave:task`, `comment:new` (server→client), `error`.

## 8. Authorization Rules

- A task is readable if `visibility = 'public'` OR `owner_id = currentUser.id`.
- A task is writable (edit/delete) only by its owner.
- A comment can be created on a task the caller can read; it cannot be edited or deleted in v1.
- **This rule is one function, called from three places**: the REST middleware guarding `GET/PATCH/DELETE /tasks/:id` and both comment routes, and the socket's `join:task` handler. Not three implementations of the same idea — one `canAccessTask(task, userId)` function, imported wherever the check is needed.

## 9. Project Structure (proposed)

```
node-typescript-todo/
  packages/
    server/
      src/
        index.ts        # entry point: builds the app, starts the HTTP server, attaches Socket.IO
        db.ts            # export const prisma = new PrismaClient(...)
        env.ts           # reads + validates process.env once, at startup
        middleware.ts    # requireAuth, optionalAuth, the error handler — small, shared, one file
        auth.ts          # register/login/logout route handlers, password hashing, JWT issuing — all of it, one file
        tasks.ts         # task route handlers + canAccessTask (exported, used by comments.ts and realtime.ts too)
        comments.ts      # comment route handlers; imports canAccessTask from tasks.ts
        realtime.ts      # Socket.IO server setup, connection/join/leave/broadcast handlers
    web/                      # React + Vite client
    shared/                   # TS types/interfaces shared by server and web
  docs/
    architecture.md
    implementation-plan.md
```

No per-feature folder, no mandated routes/service/schema split. A file grows until splitting it actually earns its keep — `auth.ts` holding both the route handlers and the password/JWT logic is fine at this size; if it got large enough that finding things in it became the problem, that's the signal to split it, not a rule applied up front. The one thing that *is* factored out on purpose is `canAccessTask` — because it's genuinely called from three different places (two route files plus the socket handler), not because "authorization logic" abstractly deserves its own file.

`index.ts` wires everything by hand: builds `prisma` once, passes it to whatever needs it as a plain function argument or module-level import, mounts each router on the Express `app`. Every dependency is a visible `import` statement or function parameter — nothing is resolved implicitly at runtime by a container.

## 10. Security Considerations

- Passwords hashed with bcrypt, never logged.
- JWT in an httpOnly, `SameSite=Lax` cookie; `Secure` conditional on `NODE_ENV === 'production'` — a hardcoded `true` breaks local HTTP testing silently (the cookie gets set but never resent by the client), so this is set up conditionally from the start rather than discovered as a bug later.
- Rate limit comment creation specifically, not reading — in-memory to start, Redis-backed once Redis exists for real-time anyway, so the limit holds across multiple instances.
- Every task/comment query scoped by `canAccessTask` at the point of the database query, not just the route layer — a missed check in one route shouldn't be able to leak a private task.
- Zod validation on every request body before it reaches a database call.
- `process.env` read and validated once, at startup (`env.ts`) — fail loudly and immediately if something required is missing, rather than discovering a silently-`undefined` value three layers deep at request time.
