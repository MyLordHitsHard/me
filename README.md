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

## Run it

Requires **Node.js 22.5+**. There are no npm dependencies: it uses the built-in `node:sqlite`, and Chart.js is vendored.

```bash
npm start            # http://localhost:3000
npm test             # API tests
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/lifeos.db` | SQLite database file |
| `ALLOW_SIGNUP` | `true` | Set to `false` to close registrations |
| `COOKIE_SECURE` | auto | Force `Secure` cookies (auto-on behind an HTTPS proxy) |

To deploy (Render, Railway, Fly, a VPS…), run `npm start` on a host with a persistent disk for `DB_PATH`.

### Load my profile

`seed/himanshu.json` holds my education, projects, achievements, certificates and skills (taken from my résumé). After signing up, go to **Settings → Data → Import** and choose that file to pre-fill the dashboard. Skill levels in it are starting estimates, so adjust them. Any other user can export their own data in the same format.

## Architecture

```
server.js              HTTP server: auth, generic CRUD, links, leaderboards, import/export, static files
lib/schema.js          entity registry: one place that defines every table, field and validation rule
lib/db.js              SQLite setup + automatic column migrations
lib/leaderboards.js    opt-in rankings
public/js/app.js       SPA shell, router, global search (press /)
public/js/store.js     API client + in-memory store + relation helpers
public/js/ui.js        forms generated from the schema, record editor (children + connections), charts
public/js/analytics.js life scores, insights, auto-SWOT, correlations
public/js/views/*.js   one module per page
```

**Relational model.** Each user owns rows in `career`, `skills`, `goals`, `exams`, `workouts`, `notes`, `sketches`, `people`, `trackers`, `checkins`, `transactions` and `swot_items`. Child tables (`skill_logs`, `study_sessions`, `workout_sets`, `interactions`, `tracker_logs`) reference their parent with cascading foreign keys. A generic `links` table connects any two records, with an optional label (for example "mentor for").

**Security.** Passwords are hashed with scrypt. Session tokens are random and stored only as hashes, in HttpOnly SameSite cookies. Every query is scoped to the signed-in user, and foreign references are ownership-checked. Mutating requests need a custom header (CSRF protection). The server sends a strict Content-Security-Policy, and all user content is rendered as text (markdown is escaped before formatting). Login and registration are rate-limited.
