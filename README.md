# Trade Journal

A personal journal for options trades. Log a trade when you open it, close it later, and grade it against a checklist of your own rules. The Stats tab shows whether following each rule actually makes you money. The app also keeps an edit history for trades you change after closing them, and tracks your journaling streak.

It runs live on Vercel, with its data in Neon Postgres. `DEPLOY.md` has the addresses, the hosts and every setting the deployed app needs. It started as SI 212 Problem Set 2 and was deployed for Problem Set 3.

## Start

Needs Node 22 or newer.

    npm install
    npm start

Then open http://127.0.0.1:3000. `npm start` builds the page and starts one server for both the page and the API. Locally the data lives in `data/pgdata/` (not committed), kept by PGlite, an in-process Postgres, so there is no database server to install. Set `DATABASE_URL` to use a real Postgres instead, or `PORT` or `DB_PATH` to change where it listens or where it stores data.

For development with hot reload, run `npm run dev` and open the URL Vite prints.

## Test

    npm test

Tests run against a fresh in-memory Postgres (PGlite) each time, so they never need a network or a secret. `server/restart.test.js` starts the real server as a separate process, writes a trade through the API, closes and edits it, stops the server, starts a new one on the same database, and reads everything back through the API.

## Try the main features

1. **Rules tab.** Add two or three rules, like "Monthly and weekly trend agree" and "Defined invalidation before entry". Rename one and delete one.
2. **Journal tab.** Click + New trade. Enter a call or put, grade it against your rules, and save. It shows under Open positions.
3. **Close it.** Click Close on the open trade, enter an exit premium, and save. It moves to Closed trades with its P/L and checklist score.
4. **Edit it after closing.** Click Edit on the closed trade and change the exit premium. The row gets an EDITED badge, and clicking the contract shows the change in its edit history.
5. **Stats tab.** Log a few more closed trades, some following your rules and some not. Stats shows win rate, expectancy, per-setup results, a cumulative P/L chart, and the followed-versus-broken edge of each rule.
6. **Restart.** Stop the server with Ctrl+C and run `npm start` again. Your trades, the edit history and the streak in the header are all still there.

## Keyboard shortcuts

`1`, `2` and `3` switch between Journal, Stats and Rules. `N` opens a new trade from the Journal tab. `Esc` cancels the trade form or leaves a trade's detail page. The status bar at the bottom lists the shortcuts that work on the current tab.

Animations (the boot screen, count-ups, the scrolling feed and the chart drawing in) turn off when your system asks for reduced motion.

## How it fits together

- `server/journal.js`: pure logic. Validation, P/L, checklist score, edit diffing, streaks and stats.
- `server/db.js`: the Postgres store. Tables `trades`, `rules`, `trade_rules`, `trade_edits` and `activity_days`.
- `server/migrations.js`: the schema, as numbered migrations recorded in `schema_migrations`. Add a new one; never edit one that has shipped.
- `server/pg.js`: the same small database interface over node-postgres (production) and PGlite (local and tests).
- `server/app.js`: the Express API under `/api`, including `GET /api/version`.
- `server/basic-auth.js`: one username and password in front of the API.
- `server/index.js`: starts the server on a laptop and serves the built page from `dist/`.
- `api/index.js`: the same Express app as a Vercel Function. `vercel.json` sends every `/api/*` request to it.
- `scripts/migrate.js`: migrates the production database during the Vercel build.
- `src/`: the React app. `Journal.jsx`, `TradeForm.jsx`, `TradeDetail.jsx`, `Stats.jsx`, `PnlChart.jsx` and `Rules.jsx`.

The deployment design and plan are in `docs/superpowers/`.
