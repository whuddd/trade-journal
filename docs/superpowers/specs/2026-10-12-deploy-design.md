# Deploying the Trade Journal (SI 212 Problem Set 3)

## Goal

Put the PS2 Trade Journal on the public internet with a frontend, a backend and a relational database, each on a public host, deploying itself on every push to `main`. Part A puts the API behind HTTP basic auth. Part B replaces that with GitHub sign-in and two levels of authorization enforced on the server.

## Decisions already made

- **Repository:** a new public repository, `whuddd/trade-journal`, starting from the PS2 code as handed in. `ps2-web-app/` in the assignments repository stays untouched.
- **Hosts:** Vercel for the frontend and the backend, Neon for Postgres.
- **Sign-in provider:** GitHub. Every classmate and the grader already has a GitHub account.

## Architecture

| part | host | how |
| --- | --- | --- |
| Frontend | Vercel | `vite build` output in `dist/`, served from Vercel's CDN. Any path that is not `/api/...` falls back to `index.html`. |
| Backend | Vercel Functions | `api/index.js` exports the existing Express app. A rewrite in `vercel.json` sends every `/api/*` request to it. Frontend and API share one origin, so there is no CORS and the session cookie is first-party. |
| Database | Neon Postgres | Created from Vercel's Storage tab (Neon integration), which sets `DATABASE_URL` on the Vercel project. Production gets its own Neon database; local development and tests never touch it. |

The PS2 app keeps its data in a SQLite file through `node:sqlite`. A serverless function has no disk that survives a redeploy (or even the next cold start), so the store moves to Postgres.

### Store

`server/db.js` becomes async and talks to a small adapter with two methods: `query(sql, params)` returning rows, and `transaction(fn)`. Two adapters:

- **Production:** `pg` Pool on `DATABASE_URL` (Neon's pooled connection string).
- **Local and tests:** PGlite, a real Postgres compiled to WebAssembly that runs in-process. `npm start` and `npm run dev` keep working with no database server to install, storing data in `data/pgdata/` (gitignored). Tests use an in-memory PGlite per test, so they never need a network or a secret.

The SQL is the same Postgres SQL for both. Route handlers become `async` (Express 5 forwards rejected promises to the error handler).

### Migrations

`server/migrations.js` holds an ordered list of SQL migrations and a `schema_migrations` table recording which have run. `migrate()` takes a Postgres advisory lock, runs whatever has not run inside one transaction, and is safe to call any number of times.

- Migration 1 is the PS2 schema translated to Postgres (`IDENTITY` ids, `BOOLEAN`, a case-insensitive unique index on `lower(text)` for rules).
- Part B adds migration 2 (users, sessions, owner columns). It only adds tables and nullable columns, so existing rows survive.

On Vercel, migrations run in the build command, after the tests and before the deploy is promoted. A failing migration fails the build, and the previous deployment keeps serving. Locally, `server/index.js` runs `migrate()` at startup.

### Build and deploy

`vercel.json` sets the build command to `npm test && npm run migrate && npm run build`. Vercel's GitHub integration builds every push to `main` as a production deploy. If a test fails, the build fails and nothing ships.

### `GET /api/version`

Returns `{ "commit": process.env.VERCEL_GIT_COMMIT_SHA }`, which Vercel sets on every Git-triggered deployment to the full SHA. Locally it returns `"dev"`. No sign-in required.

### Time zone

Streak days currently use the server's local date. Vercel runs in UTC, so a trade logged at 9 PM in Detroit would count for tomorrow. `localDay()` gets an explicit `America/Detroit` time zone through `Intl.DateTimeFormat`.

## Part A: basic auth

Middleware on every `/api` route except `/api/version` checks an `Authorization: Basic` header against `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` (constant-time compare) and answers 401 with `WWW-Authenticate: Basic` otherwise. On Vercel, if either setting is missing, every request is refused rather than let through. Locally, with neither set, auth is off. The pages load without auth.

## Part B: GitHub sign-in and levels

### Flow

1. The React app calls `GET /api/me`. A 401 shows a sign-in screen with a "Sign in with GitHub" button linking to `/api/auth/github`.
2. `/api/auth/github` makes a random `state`, stores it in a short-lived HttpOnly cookie, and redirects to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `state` and **no scope**.
3. GitHub redirects to `/api/auth/github/callback`. The server checks `state`, exchanges the code for an access token with the client secret, calls `GET https://api.github.com/user` once for the numeric id, login and avatar, upserts the user, and discards the token.
4. The server creates a session: 32 random bytes in an HttpOnly, Secure, SameSite=Lax cookie, with only its SHA-256 hash stored in `sessions` (30-day expiry). Sign-out deletes the row and clears the cookie.

### Levels

| level | who | can |
| --- | --- | --- |
| Signed out | anyone | load the pages, `GET /api/version`, start sign-in. Every other `/api` route answers **401**. |
| Member | anyone who signs in with GitHub | log, close, edit and delete **their own** trades; see their own stats, setups, streak and edit history; read the rule checklist. A trade that belongs to someone else answers 404, the same as one that does not exist. Changing the checklist answers **403**. |
| Owner | the GitHub account whose numeric id is in `OWNER_GITHUB_ID` | everything a member can, plus add, rename and delete the shared rule checklist that every member grades trades against. |

Every rule is checked in Express. React hides the rule editor from members, but that is a convenience, not the enforcement.

### Schema change (migration 2)

- `users (id, github_id UNIQUE, login, name, avatar_url, created_at)`
- `sessions (token_hash PRIMARY KEY, user_id, expires_at)`
- `trades.user_id` and `activity_days.user_id`, nullable, with `activity_days` re-keyed to `(user_id, day)`.

Rows from Part A have no owner yet. When the owner first signs in, any trade or activity day with `user_id IS NULL` is assigned to them, so the Part A data reappears in their journal. Afterwards, check that it is all there.

## Settings, by name

| setting | where it is set | who sets it |
| --- | --- | --- |
| `DATABASE_URL` | Vercel project, Production | Neon integration, automatically |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` (Part A only) | Vercel project, Production | William, in the dashboard |
| `GITHUB_CLIENT_ID` | Vercel project, Production | William (not secret, but kept beside the secret) |
| `GITHUB_CLIENT_SECRET` | Vercel project, Production | William, in the dashboard |
| `OWNER_GITHUB_ID` | Vercel project, Production | William (his numeric GitHub id) |
| `VERCEL_GIT_COMMIT_SHA` | provided by Vercel | nobody |

For signing in on localhost, the same names go in `.env.local`, which `.gitignore` covers before the first commit.

## The eight questions

**Part A**

1. *Will the data survive a redeploy?* Yes. Data lives in Neon, not on the function's disk, which is thrown away. Migrations only add.
2. *Does production get a database of its own?* Yes. `DATABASE_URL` is set for Production only. Local runs and tests use PGlite and cannot reach it.
3. *Where does each secret live?* In Vercel's Production environment settings, entered by William in the dashboard. Never in a file in the repository, never in the chat. See the settings table.
4. *Does a deploy wait for the tests?* Yes. The build command runs `npm test` first, and a failing test fails the build, so the previous deployment keeps serving.

**Part B**

1. *Who registers the app with GitHub?* William, at github.com/settings/developers, as an OAuth App owned by his account.
2. *What are the redirect URLs?* `http://localhost:5173/api/auth/github/callback` for local development (Vite proxies `/api`) and `https://<production domain>/api/auth/github/callback` for the live app. Both go on the one registration.
3. *Where does the client secret go?* `GITHUB_CLIENT_SECRET` in Vercel's Production settings, typed in by William. For localhost, the same name in `.env.local`, which git ignores.
4. *What does the app ask GitHub for, and does it need all of it?* No scopes, which gives read access to public profile information only. It reads the numeric id (the identity), the login (shown in the header), and the avatar. The access token is used once and never stored.

## Checks once live

- Part A: push a visible change and see it live; add a trade, push, and see it is still there; connect the Vercel CLI and show the log line for a request.
- Part B: `curl` the `Protected:` path signed out and get 401; a second GitHub account tries `POST /api/rules` and gets 403; the Part A trade is still there after migration 2.
- `curl /api/version` matches `git rev-parse HEAD` on `main`.
- A secret scanner (gitleaks) over the whole history finds nothing.

## Out of scope

Rate limiting, CSRF tokens beyond SameSite=Lax plus JSON-only bodies, multiple rule checklists, and deleting a user's account.
