# Copilot Usage Dashboard

> ⚡ **A vibe-coded dashboard to check the usage of AI tokens.** Built for fun to visualize
> how a team burns through GitHub Copilot — **AI-credit (AIC)** consumption, included-vs-billed
> usage, and per-user activity — dressed up in a nostalgic **Windows 2000** skin.

A simple dashboard for **GitHub Copilot (Enterprise)** usage — a team overview, a per-user
list, and a click-through detail view for each user. Tiny Node (Express) backend + a no-build
vanilla-JS frontend. Runs on bundled demo data out of the box, so you can explore every screen
without configuring anything. Charts are interactive (hover for a crosshair + tooltip), and the
whole UI is a compact classic-Windows theme.

## AI credits (AIC)

Since GitHub Copilot moved to **usage-based billing** (June 2026), usage is measured in
**AI credits (AIC)**, where **1 credit = $0.01 USD**. Credits are derived from token
consumption (input, output, cached) at each model's rate. Code completions and next-edit
suggestions are **free**; credits are spent on Copilot Chat, CLI, the cloud agent, Spaces,
Spark and third-party agents. Copilot Enterprise includes **3,900 credits/user/month**.

Per-user consumption comes from the metrics API's **`ai_credits_used`** field (in the
`users-1-day` / `users-28-day` reports) — an overall per-user total, not broken down by
model or feature.

### Included vs additional (billing)

The **included vs billable** split is *not* in the metrics API — it comes from the billing
usage API (`GET /{orgs|enterprises}/{x}/settings/billing/ai_credit/usage`). Each line carries
`grossQuantity`, `discountQuantity` (**included**, covered by the monthly pool) and
`netQuantity` (**additional**, billed at $0.01). The Billing window shows pool consumption with
an overage bar and the actual **$ billed**. Note: credits are **pooled** at the billing-entity
level, so there is no per-user allowance — the per-user stat is each user's **share of the
team's total**, not a personal quota.

## Agentic metrics only

This dashboard focuses on **agentic** usage — Chat, autonomous **agent sessions**, and PR
summaries (the work that consumes AI credits). Code completions / suggestion-acceptance
metrics are intentionally **not** shown; they're free and not the point.

Each user also carries an admin-set **credit limit**; the dashboard surfaces **usage vs limit
and over-limit** (per-user budgets, from the budgets API when live).

## Screens
- **Team overview** — KPIs (active users, **AI credits used** + USD, **agent sessions**, chats,
  PR summaries), a **Billing** window (included / additional / $ billed with an overage bar),
  an interactive users trend, the agentic feature mix, and top models by AI-credit usage.
- **Individual users** — searchable, sortable cards (sort by AI credits / **over limit** /
  agent sessions) showing credits, agent sessions, **% of team**, and a **limit / over-limit**
  tag.
- **User detail** — AI credits ($), **limit + over-limit**, % of team, agent sessions, chats,
  a **Used-tokens-over-time** chart, agentic modes, and models by AI-credit usage.

## Saved snapshots

Every **Fetch usage** persists the pulled dataset to `data/history.json`, keyed by report
date — **add-or-update** (re-fetching the same date overwrites that entry). `GET /api/snapshots`
lists what's saved, so history can be reused later. The `data/` dir is git-ignored.

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
                     clippy.js · chatbot.js · chatbot-engine.js (Clippy + rule-based bot)
sample-data.json     bundled demo data
test/                chatbot.test.js · fixtures.js (Bun unit tests for the rule engine)
```

## Tests

The rule-based chatbot engine (`public/chatbot-engine.js`) is unit-tested with
[Bun](https://bun.sh) — 166 tests / 472 assertions covering helpers, the knowledge
base, intent routing, live-data replies, graceful no-data, math, games, and
robustness.

> **Bun is required to run the tests** (they use `bun:test`). The engine itself is
dependency-free and loads fixtures via `readFileSync` (no import attributes), so
it works on Node 18+ too — only the test runner needs Bun.

```bash
bun test      # or: npm test (which runs `bun test`)
```

Clippy (`public/clippy.js`) loads [`clippyjs@0.1.0`](https://www.npmjs.com/package/clippyjs)
from CDN at runtime; if the CDN is unreachable, the dashboard still works without him.
