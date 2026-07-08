# Copilot Usage Dashboard

> ⚡ **A vibe-coded dashboard to check the usage of AI tokens.** Built for fun to visualize
> how a team burns through GitHub Copilot — token/credit consumption, adoption, and per-user
> activity — with a modern gradient UI.

A simple, modern dashboard for **GitHub Copilot (Enterprise)** usage — a team overview,
a per-user list, and a click-through detail view for each user. Built with a tiny Node
(Express) backend + a no-build vanilla-JS frontend. Runs on bundled demo data out of the box,
so you can explore every screen without configuring anything.

## Screens
- **Team overview** — KPIs (active users, **tokens used**, acceptance rate, lines accepted,
  chats), trend charts, feature mix, and top languages / editors / models.
- **Individual users** — searchable, sortable cards (default sort: **tokens used**) with an
  activity sparkline per user.
- **User detail** — click any user for their modes of usage, tokens consumed per model,
  editors, languages, and activity over time.

## Quick start

```bash
npm install
npm start
# → http://127.0.0.1:3000
```

With no token configured, the app runs on **bundled demo data** (`sample-data.json`) so you
can explore every screen immediately — a "Demo data" banner makes the source clear.

## Connect to live GitHub data

Edit **`config.json`** (created from `config.example.json`; it is git-ignored):

```jsonc
{
  "server":  { "host": "127.0.0.1", "port": 3000 },
  "github":  { "token": "ghp_…", "apiBaseUrl": "https://api.github.com", "apiVersion": "2022-11-28" },
  "targets": { "enterprise": "my-enterprise", "organizations": ["my-org"], "teams": [] },
  "defaults": { "scope": "enterprise", "days": 28 },
  "useSampleDataFallback": true
}
```

Set `github.token` **and** at least one target (`enterprise` or an org). Restart the server.
If a live call fails and `useSampleDataFallback` is `true`, the app falls back to demo data
with a notice instead of erroring.

### Token permissions
- **Enterprise:** `manage_billing:copilot` **or** `read:enterprise`
  (fine-grained: *View Enterprise Copilot Metrics*).
- **Organization:** `read:org` (fine-grained: *View Organization Copilot Metrics*).
- Copilot metrics need **≥ 5 active members** or the API returns empty.

## What it shows

| Tier | Source | Content |
|------|--------|---------|
| **Team overview** | `/copilot/metrics` (aggregate) | KPIs, active/engaged users, acceptance rate, lines accepted, feature mix, top languages/editors/models |
| **Users list** | `/copilot/metrics/{date}` report exports | per-user cards: active days, activity sparkline, acceptance rate, top model/editor |
| **User detail** | same | modes of usage, models, editors, languages, activity over time |

> **Note:** `/copilot/metrics` is **aggregated** — it has no per-named-user rows. The per-user
> tiers are derived from the daily report **download links**. If a target's report lacks
> per-user granularity, those tiers degrade gracefully with a notice.

## Project layout

```
server.js            Express server + /api proxy + sample-data fallback
src/config.js        loads & validates config.json
src/github.js        GitHub Copilot Metrics API client (follows report download links)
src/transform.js     normalizes raw responses into the UI shape
public/              index.html · styles.css · app.js · charts.js (SVG charts)
sample-data.json     bundled demo data
```
