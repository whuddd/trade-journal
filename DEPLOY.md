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

## Settings

Every setting by name, and where it is set. No value appears in this repository.

| setting | where it is set | used for |
| --- | --- | --- |
| `DATABASE_URL` | Vercel project, Production environment (set by the Neon integration) | the backend's connection to Neon, and the build's migration step |
| `BASIC_AUTH_USER` | Vercel project, Production environment | the username in front of every API route |
| `BASIC_AUTH_PASSWORD` | Vercel project, Production environment | the password in front of every API route |
| `VERCEL_GIT_COMMIT_SHA` | provided by Vercel on every Git deploy | the `commit` that `/api/version` reports |

The frontend's build needs no settings. It calls the API on its own domain.

If `BASIC_AUTH_USER` or `BASIC_AUTH_PASSWORD` is missing on Vercel, every API request is refused rather than let through.

## Who may do what

| level | can |
| --- | --- |
| Anyone | load the pages and `GET /api/version` |
| Holder of the one username and password | every other API route |
