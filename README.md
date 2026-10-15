# LifeOS: a career & life dashboard

A private, multi-user dashboard that covers the major areas of your life: career, learning, health, mind, relationships and money. All of it is connected through a relational model and summarised with charts, analysis and an automatic SWOT.

Anyone can sign up and get their own dashboard. Joining **leaderboards** is opt-in, for a skill, a custom tracker or overall activity.

## Features

| Area | What you get |
|---|---|
| **Dashboard** | Life score, KPIs (study hours, workout minutes, check-in streak, next exam, catch-ups due), life-balance radar, upcoming events, auto insights, weekly charts. Widgets can be hidden and reordered. |
| **Career** | Timeline of education, jobs, internships, projects, certificates and achievements; a drag-and-drop **application pipeline** (applied → interview → offer / rejected). |
| **Goals** | Kanban board for every life area with deadlines, progress and drag-to-update. |
| **Skills** | Level vs target, practice logs, weekly practice chart, one-click leaderboard opt-in. |
| **Exam tracker** | Countdown, prep-hours goal, required daily pace, study sessions by topic, results vs target. |
| **Workout tracker** | Sessions with exercises (sets / reps / weight), weekly minutes by type, personal records, estimated 1RM, strength progress. |
| **Wellbeing** | 30-second daily check-in: mood, energy, sleep, focus, stress, gratitude. |
| **Finance** | Income, expenses, savings, monthly trend, spending by category, savings rate. |
| **Custom trackers** | Track anything (pages read, water, LeetCode problems…) with daily goals. Each tracker can have its own leaderboard. |
| **People** | Personal CRM: relation, company, closeness, birthdays, "contact every N days" reminders, interaction log, network-by-company chart. |
| **Notes** | Markdown notes with tags, pinning, `[[wiki links]]` and backlinks. |
| **Sketch pad** | Pen (pressure-sensitive), highlighter, eraser, line / box / circle / text, undo/redo, gallery, PNG export. |
| **Connections** | Link *any* record to any other (a mentor to a skill, a note to an exam, a project to the skills it used) and explore it as an interactive force-directed graph. |
| **Analysis** | Area-score breakdown, 26-week activity heatmap, 16-week trends, habit **correlation matrix**, sleep-vs-mood scatter, all insights. |
| **SWOT** | Strengths / weaknesses / opportunities / threats generated from your data, plus your own items and TOWS strategy ideas. |
| **Leaderboards** | Opt-in boards per skill, per custom tracker and for activity (workout minutes, study hours, check-in streak…). Other members see only your display name, headline and score. |
| **Settings** | Theme (system / light / dark), accent colour, currency, modules on/off, dashboard widgets, personal targets, JSON export / import, sample data, password change, account deletion. |

## Run it locally

Requires **Node.js 20+**.

```bash
npm install
npm start            # http://localhost:3000
```

If `DATABASE_URL` isn't set, LifeOS uses **PGlite**, an embedded Postgres stored in `data/pglite/`, so local runs need no setup. Set `DATABASE_URL` to use any real Postgres (local, Neon, Supabase…).

```bash
npm test             # API tests on embedded PGlite
npm run test:pg      # same tests on a real Postgres (TEST_DATABASE_URL — the database is wiped!)
```

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string (Neon: use the **pooled** one) |
| `PGLITE_DIR` | `data/pglite` | Where embedded PGlite stores data when `DATABASE_URL` is unset |
| `PORT` | `3000` | HTTP port (local server only) |
| `ALLOW_SIGNUP` | `true` | Set to `false` to close registrations |
| `COOKIE_SECURE` | auto | Force `Secure` cookies (auto-on behind HTTPS) |

## Deploy for free: Vercel + Neon Postgres

The repo is ready to deploy as-is: `vercel.json` serves `public/` from Vercel's CDN, and `api/index.js` runs the API as a serverless function. Tables are created automatically on the first request.

1. Sign in at **[vercel.com](https://vercel.com)** with GitHub, on the free **Hobby** plan.
2. **Add New → Project** and import this repository. Leave the framework preset as **Other** and the build settings at their defaults.
3. Before or after the first deploy, open the project's **Storage** tab, then **Create Database → Neon** (the free plan). Pick a region close to you and connect it to the project. This adds `DATABASE_URL` to the environment variables automatically.
   *Alternative:* create a project at **[neon.tech](https://neon.tech)**, copy the **pooled** connection string, and add it in Vercel under **Settings → Environment Variables** as `DATABASE_URL`.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the function picks up `DATABASE_URL`.
5. Open `https://<your-project>.vercel.app/healthz`. It should return `{"ok":true}`. Then open the site and create your account.
6. Optional: once your friends have signed up, set `ALLOW_SIGNUP=false` and redeploy.

Every push to the production branch redeploys automatically.

### Make it fast: put the function next to the database

This matters most for speed. Every API call talks to the database, so the Vercel function and the Neon database **must be in the same region**. Vercel runs functions in Washington DC (`iad1`) by default. If your Neon database is in Singapore, each database round trip crosses the planet (about 200+ ms) and pages feel slow.

1. In Neon, check your project's region: **Project settings → Region**, or look in the host name of the connection string, e.g. `….ap-southeast-1.aws.neon.tech`.
2. In Vercel, go to **Project → Settings → Functions → Function Region**, select the matching region, and redeploy:

| Neon region | Vercel function region |
|---|---|
| `aws-us-east-1` (N. Virginia) | `iad1` (Washington DC) |
| `aws-us-east-2` (Ohio) | `cle1` (Cleveland) |
| `aws-us-west-2` (Oregon) | `pdx1` (Portland) |
| `aws-eu-central-1` (Frankfurt) | `fra1` (Frankfurt) |
| `aws-eu-west-2` (London) | `lhr1` (London) |
| `aws-ap-southeast-1` (Singapore) | `sin1` (Singapore), the closest pair to India |
| `aws-ap-southeast-2` (Sydney) | `syd1` (Sydney) |
| `aws-sa-east-1` (São Paulo) | `gru1` (São Paulo) |

3. Check `https://<your-project>.vercel.app/healthz`. `functionRegion` should match `databaseRegion`, and `dbRoundTripMs` should be in single digits. Every API response also carries a `Server-Timing` header, visible in the browser DevTools Network tab.

The server is built to need about one database round trip per request: sessions are cached briefly in memory, writes are single statements, the whole dashboard loads in one query, and the schema check on a cold start is a single query.

**Free-tier notes**

- Vercel caps request bodies at about 4.5 MB. The app keeps each sketch below that and uploads sketch images one at a time during imports.
- Neon's free database pauses after a few minutes idle, and Vercel shuts idle function instances down. The first request after a quiet period therefore takes about 1–2 s. After that, requests should be fast.
- The login rate limit is kept in memory per function instance, so it's weaker on serverless. That's fine for personal use.
- Vercel Hobby is for non-commercial use.

### Load my profile

`seed/himanshu.json` holds my education, projects, achievements, certificates and skills (taken from my résumé). After signing up, go to **Settings → Data → Import** and choose that file to pre-fill the dashboard. Skill levels in it are starting estimates, so adjust them. Any other user can export their own data in the same format.

## Architecture

```
server.js              request handler: auth, generic CRUD, links, leaderboards, import/export, static files
api/index.js           Vercel serverless entry (re-exports the handler)
vercel.json            static output dir, API rewrites, security headers
lib/schema.js          entity registry: one place that defines every table, field and validation rule
lib/db.js              Postgres (pg) / PGlite adapter, schema creation + automatic column migrations
lib/leaderboards.js    opt-in rankings
public/js/app.js       SPA shell, router, global search (press /)
public/js/store.js     API client + in-memory store + relation helpers
public/js/ui.js        forms generated from the schema, record editor (children + connections), charts
public/js/analytics.js life scores, insights, auto-SWOT, correlations
public/js/views/*.js   one module per page
```

**Relational model.** Each user owns rows in `career`, `skills`, `goals`, `exams`, `workouts`, `notes`, `sketches`, `people`, `trackers`, `checkins`, `transactions` and `swot_items`. Child tables (`skill_logs`, `study_sessions`, `workout_sets`, `interactions`, `tracker_logs`) reference their parent with cascading foreign keys. A generic `links` table connects any two records, with an optional label (for example "mentor for").

**Security.** Passwords are hashed with scrypt. Session tokens are random and stored only as hashes, in HttpOnly SameSite cookies. Every query is scoped to the signed-in user, and foreign references are ownership-checked. Mutating requests need a custom header (CSRF protection). The server sends a strict Content-Security-Policy, and all user content is rendered as text (markdown is escaped before formatting). Login and registration are rate-limited.
