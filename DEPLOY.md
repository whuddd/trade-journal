App: https://trade-journal-two-sigma.vercel.app
API: https://trade-journal-two-sigma.vercel.app
Protected: /api/trades

# Deploying the Trade Journal

## Hosts

| part | host | what runs there |
| --- | --- | --- |
| Frontend | Vercel | The React app, built by `vite build` into `dist/` and served from Vercel's CDN. Any path that is not `/api/...` gets `index.html`. |
| Backend | Vercel Functions | The Express app in `server/app.js`, exported by `api/index.js`. `vercel.json` rewrites every `/api/*` request to it. Same domain as the frontend, so `API:` above is the same address as `App:`. |
| Database | Neon (Postgres) | Every trade, rule, checklist tick, edit and journaling day. Added to the Vercel project from its Storage tab. |

## How a push becomes a deploy

Vercel's GitHub integration builds every push to `main` as a production deploy. The build command in `vercel.json` is `npm test && npm run migrate && npm run build`:

1. `npm test` runs the whole suite against an in-memory Postgres. A failing test fails the build.
2. `npm run migrate` applies any new migration from `server/migrations.js` to the production database. A failing migration fails the build.
3. `npm run build` builds the frontend.

When any step fails, nothing ships and the previous deployment keeps serving. `GET /api/version` returns the commit the live backend was built from, so `curl <API>/api/version` against `git rev-parse origin/main` shows whether the last push reached the live app.

## Sign-in

Sign-in is through GitHub with OAuth, registered as an OAuth App on the owner's GitHub account. The app asks for no scopes, so GitHub shares only a user's public profile. The server reads the numeric GitHub id, the login and the avatar, uses the access token for that one request, and never stores it.

Redirect URLs on the registration:

- `https://trade-journal-two-sigma.vercel.app/api/auth/github/callback` for the live app
- `http://127.0.0.1/api/auth/github/callback` for running locally (GitHub accepts any port on a loopback address)

A session is a random token in an HttpOnly, Secure, SameSite=Lax cookie, lasting 30 days. The database keeps only the token's SHA-256 hash.

## Settings

Every setting by name, and where it is set. No value appears in this repository.

| setting | where it is set | used for |
| --- | --- | --- |
| `DATABASE_URL` | Vercel project, Production environment (set by the Neon integration) | the backend's connection to Neon, and the build's migration step |
| `GITHUB_CLIENT_ID` | Vercel project, Production environment | identifies the app to GitHub when sign-in starts |
| `GITHUB_CLIENT_SECRET` | Vercel project, Production environment (marked sensitive) | proves to GitHub that the code exchange comes from this server |
| `OWNER_GITHUB_ID` | Vercel project, Production environment | the numeric GitHub account id that gets the owner level |
| `VERCEL_GIT_COMMIT_SHA` | provided by Vercel on every Git deploy | the `commit` that `/api/version` reports |

The frontend's build needs no settings. It calls the API on its own domain.

For running locally, the three `GITHUB_`/`OWNER_` settings go in `.env.local`, which `.gitignore` covers and `npm start` reads. Without `DATABASE_URL` locally, the data lives in PGlite under `data/pgdata/`.

If the GitHub settings are missing, nobody can sign in, so every data route keeps answering 401. If `OWNER_GITHUB_ID` is missing, everybody who signs in is a member.

## Who may do what

Every rule below is enforced in Express (`server/auth.js` and `server/app.js`), not only in React.

| level | who | can | refused with |
| --- | --- | --- | --- |
| Signed out | anyone | load the pages, `GET /api/version`, start sign-in | **401** on every other `/api` route |
| Member | anyone who signs in with GitHub | read the shared rule checklist; log, close, edit and delete their own trades; see their own stats, setups, streak and edit history | **403** on adding, renaming or deleting a rule; **404** on a trade that belongs to someone else, the same as one that does not exist |
| Owner | the GitHub account in `OWNER_GITHUB_ID` | everything a member can, plus add, rename and delete the rule checklist every member grades against | |

Trades and journaling days recorded before sign-in existed (Part A) have no user. The owner claims them the first time they sign in.
