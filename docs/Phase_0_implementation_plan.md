# Phase 0 Implementation Plan — Project Setup

Expands [implementation-plan.md](./implementation-plan.md)'s Phase 0 into exact commands and file contents. Versions below were checked against the registry on 2026-10-22 — re-run the `npm view` commands before installing if this is done later, since the whole point of the pinning step is not to trust a cached number.

Target layout at the end of this phase:

```
node-typescript-tasks/
  package.json
  tsconfig.base.json
  eslint.config.js
  .prettierrc
  .gitignore
  docker-compose.yml
  packages/
    server/
      package.json
      tsconfig.json
      .env
      prisma/
        schema.prisma
      src/
        index.ts
        db.ts
        env.ts
    web/
      package.json
      tsconfig.json
    shared/
      package.json
      tsconfig.json
```

`web` and `shared` get stub `package.json`/`tsconfig.json` files now because npm workspaces requires every listed workspace to have a `package.json` before `npm install` will succeed — their real content arrives in Phase 1 (`shared`) and Phase 4 (`web`).

---

## 0.0 Pin the Node version for this project

Global mise default on this machine is Node 26, which is newer than what architecture.md asks for ("Node.js (LTS)"). Pin the LTS line at the project level so `node`/`npm` resolve consistently for anyone who `cd`s in:

```bash
cd /Users/jasonebueng/Dev_Projects/node-typescript-tasks
mise use node@lts
```

This writes `mise.toml` with something like:

```toml
[tools]
node = "22"
```

---

## 0.1 `git init` + `.gitignore`

```bash
git init
```

Write `.gitignore`:

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
*.log
.DS_Store
```

---

## 0.2 npm workspace root

`package.json`:

```json
{
  "name": "node-typescript-tasks",
  "private": true,
  "workspaces": [
    "packages/server",
    "packages/web",
    "packages/shared"
  ],
  "scripts": {
    "dev:server": "npm run dev -w packages/server",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "type": "module",
  "devDependencies": {
    "typescript": "6.0.3",
    "eslint": "10.13.0",
    "typescript-eslint": "8.72.0",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.10"
  }
}
```

`typescript@6.0.3`, not the `7.0.2` currently tagged `latest` — 7.x is TypeScript's new Go-ported compiler, and `typescript-eslint@8.72.0` (current as of this writing, including its `canary` tag) still declares `peerDependencies: { typescript: ">=4.8.4 <6.1.0" }`. Installing `7.0.2` at the root fails `npm install` outright with an `ERESOLVE` conflict against that peer range. Re-check `npm view typescript-eslint@latest peerDependencies` before bumping past `6.0.3` — this is exactly the kind of "latest isn't trustworthy" trap Prisma's `latest` tag hit in §0.5, just on the lint-tooling side instead.

Create the package folders and stubs:

```bash
mkdir -p packages/server/src packages/server/prisma packages/web/src packages/shared/src
```

`packages/server/package.json`:

```json
{
  "name": "@node-typescript-tasks/server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  }
}
```

`packages/web/package.json` (stub — Vite scaffold replaces this in Phase 4):

```json
{
  "name": "@node-typescript-tasks/web",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
```

`packages/shared/package.json` (stub — real exports arrive in Phase 1):

```json
{
  "name": "@node-typescript-tasks/shared",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts"
}
```

`packages/shared/src/index.ts` (placeholder so the package isn't empty):

```ts
export {};
```

---

## 0.3 TypeScript configs

Root `tsconfig.base.json` — shared strict settings only, no `module`/`moduleResolution`/`target` (those differ per package):

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "sourceMap": true
  }
}
```

`packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2023"],
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/web/tsconfig.json` (stub for now, real Vite config lands in Phase 4):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

`server` and `shared` both use `nodenext` since they run under plain Node; `web` uses `bundler` since Vite resolves modules itself. This is the difference the Phase 0 bullet calls out.

Install TypeScript and `tsx` (dev-time runner, so `npm run dev` doesn't need a separate build step) at the root and in `server`:

```bash
npm install -D typescript@6.0.3 tsx@4.23.15 -w packages/server
```

---

## 0.4 Server runtime dependencies

```bash
npm install express@5.3.0 cookie-parser@1.4.7 cors@2.8.6 zod@4.6.7 jsonwebtoken@9.0.3 bcrypt@6.0.0 -w packages/server

npm install -D @types/express@5.0.6 @types/cookie-parser@1.4.10 @types/cors@2.8.19 @types/jsonwebtoken@9.0.10 @types/bcrypt@6.0.0 @types/node@26.6.5 -w packages/server
```

`express@5.3.0` is current stable (the `latest` dist-tag for the 4.x line is `latest-4`, not `latest` — confirms Express 5 is the one to install, not something to avoid because the major version bumped).

---

## 0.5 Prisma, pinned to a confirmed-stable version

Check before trusting `latest`:

```bash
npm view prisma dist-tags
```

On 2026-10-22 this returned:

```json
{
  "latest": "8.0.0-rc.26",
  "prev": "7.10.1",
  "next": "8.0.0-rc.10"
}
```

`latest` points at an `8.0.0` release candidate, not a stable release — this is exactly the trap the Phase 0 bullet warns about. `prev` (`7.10.1`) is the last stable tag. Install that explicitly:

```bash
npm install --save-exact prisma@7.10.1 @prisma/client@7.10.1 -w packages/server
```

Driver-adapter packages (`db.ts` below constructs `PrismaClient` with an `adapter`, per architecture.md §9):

```bash
npm install --save-exact @prisma/adapter-pg@7.10.1 pg@8.23.1 -w packages/server
npm install -D --save-exact @types/pg@8.23.1 -w packages/server
```

---

## 0.6 ESLint + Prettier at the repo root

```bash
npm install -D eslint-config-prettier@10.1.8 @eslint/js
```

No `-w` flag — `-w` names a workspace to install into, and the root isn't one, so `-w .` fails with `No workspaces found`. Omitting the flag installs at the root, which is what's wanted here.

Root `eslint.config.js` (flat config):

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
);
```

`@eslint/js` is a transitive dep of `eslint` but needs its own install for the direct import — already covered by the combined install command above.

Root `.prettierrc`:

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

---

## 0.7 Postgres + Redis via Docker Compose

Built up in passes rather than written whole — each step below is driven by what the previous `docker compose up` actually showed, not decided up front.

**Pass 1 — bare minimum, see what breaks.**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports:
      - '5432:5432'

  redis:
    image: redis:8-alpine
    ports:
      - '6379:6379'
```

```bash
docker compose up
```

`redis` boots fine. `postgres` doesn't — the official image refuses to start without a superuser password, and exits with:

```
Error: Database is uninitialized and superuser password is not specified.
       You must specify POSTGRES_PASSWORD to a non-empty value...
```

**Pass 2 — fix Postgres's required env vars.**

```yaml
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - '5432:5432'
```

`docker compose up` again — both containers now boot clean.

**Pass 3 — notice Redis has no auth yet.** `redis-cli -h localhost -p 6379 ping` returns `PONG` with no password at all. Architecture.md's security section (and the Phase 3 "confirm Redis auth" check) expects a connection without the password to fail, so that gap gets closed now rather than left for Phase 3 to catch:

```yaml
  redis:
    image: redis:8-alpine
    command: redis-server --requirepass dev_redis_password
    ports:
      - '6379:6379'
```

Rerun, confirm both ways: `redis-cli ... ping` with no `-a` now returns `NOAUTH Authentication required`, and with `-a dev_redis_password` returns `PONG`.

**Pass 4 — restart the stack, lose everything.** `docker compose down && docker compose up` — any rows inserted while testing Postgres are gone, because nothing's persisted outside the container's writable layer. That's the trigger for adding a volume, not a decision made in advance:

```yaml
  postgres:
    # ...
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Redis gets no equivalent `volumes:` entry — per architecture.md §4, it carries only the live fan-out signal, not durable state, so losing it on restart is the correct behavior, not a gap to fix.

**Final `docker-compose.yml`** (same end state, arrived at through passes 1–4):

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:8-alpine
    command: redis-server --requirepass dev_redis_password
    ports:
      - '6379:6379'

volumes:
  postgres_data:
```

---

## 0.8 Prisma init + `db.ts` singleton

```bash
cd packages/server
npx prisma init --datasource-provider postgresql
cd ../..
```

This generates `packages/server/prisma/schema.prisma` and `packages/server/.env`. Prisma 7 replaced the old `prisma-client-js` generator with `prisma-client`, which changes three things the original draft of this plan got wrong — corrected here against the installed `prisma-upgrade-v7` skill rather than guessed:

1. **`output` is mandatory**, not optional. Unlike `prisma-client-js`, `prisma-client` has no default `node_modules` location — omit `output` and `prisma generate` has nowhere to write the client.
2. **`datasource.url` moves out of `schema.prisma`** and into a new `prisma.config.ts`, read by the CLI (`generate`, `migrate dev`, etc.) — not by your application code.
3. **Nothing loads `.env` automatically anymore**, for either the CLI or your app. Both need an explicit `dotenv` import.

```bash
npm install @prisma/adapter-pg pg -w packages/server
npm install dotenv -w packages/server
```

`packages/server/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

`packages/server/prisma.config.ts` — note the filename: the Prisma CLI only auto-discovers `prisma.config.ts`, so if `prisma init` (or an upgrade tool) produced `prisma7.config.ts` instead, rename it, or every CLI command needs an explicit `--config` flag:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

`packages/server/.env`:

```bash
DATABASE_URL="postgresql://app:app@localhost:5432/app"
```

`packages/server/src/db.ts` — imports from the generated client path set by `output` above (`../src/generated/prisma` relative to `schema.prisma` resolves to `packages/server/src/generated/prisma`, so `./generated/prisma/client` relative to this file), not from `@prisma/client`:

```ts
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

Run `npx prisma generate` from `packages/server` before `db.ts` will typecheck — the `./generated/prisma` directory doesn't exist until then. Add it to `.gitignore` too, since it's generated output, not source:

```gitignore
/packages/server/src/generated/
```

---

## 0.9 `env.ts` — validate `process.env` once, at startup

`packages/server/src/env.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Missing or invalid environment variables — see above.');
}

export const env = parsed.data;
```

`JWT_SECRET` joins this schema in Phase 1, when `auth.ts` first needs it — adding it now would make `env.ts` validate a secret nothing yet reads.

---

## 0.10 Bare Express app — `GET /health`

`packages/server/src/index.ts` — `dotenv/config` has to be the first import, so `process.env` is populated before `env.js`'s top-level `schema.safeParse(process.env)` runs (ES module imports execute depth-first in source order, so this works as long as it's literally the first line):

```ts
import 'dotenv/config';
import express from 'express';
import { env } from './env.js';
import { prisma } from './db.js';

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
```

`db.ts` is imported here even though nothing queries it yet, so Phase 0's "done when" exercises the full chain (env validated → Prisma client constructed against a real `DATABASE_URL` → server boots) instead of just an empty Express app.

---

## Verification — "Done when"

```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Confirm Redis requires its password
redis-cli -h localhost -p 6379 ping            # expect: NOAUTH Authentication required
redis-cli -h localhost -p 6379 -a dev_redis_password ping   # expect: PONG

# 3. Install everything
npm install

# 4. Generate the Prisma client and run the (empty) first migration
cd packages/server
npx prisma generate
npx prisma migrate dev --name init
cd ../..

# 5. Boot the server
npm run dev:server

# 6. In another shell, confirm it responds
curl -i http://localhost:3000/health   # expect: HTTP/1.1 200 OK, {"status":"ok"}
```

All six steps passing clean is Phase 0 done — nothing here depends on the `users`/`tasks`/`comments` schema, auth, or routing beyond `/health`; those start in Phase 1.
