// Express server: serves the static frontend and proxies the GitHub Copilot Metrics API.
// Falls back to sample-data.json whenever no live API connection is available or a call fails.
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './src/config.js';
import { createClient, GitHubError } from './src/github.js';
import { transformOverview, transformUsers, transformBilling } from './src/transform.js';

const root = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const client = cfg.canUseLiveApi ? createClient(cfg) : null;

// ---- sample data (lazy, cached) ----
let sampleCache = null;
function sampleData() {
  if (!sampleCache) sampleCache = JSON.parse(readFileSync(join(root, 'sample-data.json'), 'utf8'));
  return sampleCache;
}

// ---- in-memory cache of the last live fetch per scope/org ----
const liveCache = new Map(); // key -> { at, data }
const TTL = 5 * 60 * 1000;

async function getData(scope, org) {
  // No live connection at all -> demo data.
  if (!client) return { source: 'sample', ...sampleData() };

  const key = `${scope}:${org || ''}`;
  const cached = liveCache.get(key);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  try {
    const days = await client.getMetrics(scope, org);
    const meta = {
      scope, target: scope === 'org' ? org : cfg.targets.enterprise,
      windowDays: (days || []).length, teams: cfg.targets.teams,
      startDate: days?.[0]?.date, endDate: days?.[days.length - 1]?.date,
    };
    const { overview } = transformOverview(days, meta);

    // Per-user data lives in the {date} report exports. Best-effort for the latest day.
    let users = [];
    try {
      const latest = meta.endDate;
      if (latest) {
        const report = await client.getDayReport(scope, org, latest);
        users = transformUsers([{ date: latest, files: report.files }]);
      }
    } catch (e) {
      console.warn('[users] per-user report unavailable:', e.message);
    }

    // ai_credits_used is per-user only; roll it up for the overview KPI.
    overview.kpis.aiCredits = users.reduce((a, u) => a + (u.aiCredits || 0), 0);
    meta.includedCreditsPerUser = 3900;
    meta.creditUsd = 0.01;

    // Billing (included vs additional) comes from a different endpoint/scope — best-effort.
    let billing = null;
    try {
      const usage = await client.getAiCreditUsage(scope, org);
      billing = transformBilling(usage, users.length);
    } catch (e) {
      console.warn('[billing] ai_credit usage unavailable:', e.message);
    }

    const data = { source: 'live', meta, overview, users, billing, usersDegraded: users.length === 0 };
    liveCache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (cfg.useSampleDataFallback) {
      console.warn('[live] falling back to sample data:', err.message);
      return { source: 'sample', sampleReason: err.message, ...sampleData() };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
const app = express();

app.get('/api/config', (_req, res) => {
  res.json({
    canUseLiveApi: cfg.canUseLiveApi,
    scope: cfg.defaults.scope,
    days: cfg.defaults.days,
    enterprise: cfg.targets.enterprise || null,
    organizations: cfg.targets.organizations,
    teams: cfg.targets.teams,
  });
});

app.get('/api/overview', async (req, res) => {
  try {
    const data = await getData(scopeOf(req), req.query.org);
    res.json({ source: data.source, meta: data.meta, overview: data.overview, billing: data.billing || null, sampleReason: data.sampleReason });
  } catch (err) { sendErr(res, err); }
});

app.get('/api/users', async (req, res) => {
  try {
    const data = await getData(scopeOf(req), req.query.org);
    const q = (req.query.q || '').toString().toLowerCase();
    let users = data.users || [];
    if (q) users = users.filter(u => u.login.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q));
    // Send full user objects (incl. detail) so the client can open a user without a second request.
    res.json({ source: data.source, meta: data.meta, users, usersDegraded: data.usersDegraded });
  } catch (err) { sendErr(res, err); }
});

app.get('/api/users/:login', async (req, res) => {
  try {
    const data = await getData(scopeOf(req), req.query.org);
    const user = (data.users || []).find(u => u.login === req.params.login);
    if (!user) return res.status(404).json({ error: `No data for user ${req.params.login}` });
    res.json({ source: data.source, meta: data.meta, user });
  } catch (err) { sendErr(res, err); }
});

app.use(express.static(join(root, 'public')));

function scopeOf(req) {
  const s = (req.query.scope || cfg.defaults.scope || 'enterprise').toString();
  return s === 'org' ? 'org' : 'enterprise';
}
function sendErr(res, err) {
  const status = err instanceof GitHubError ? err.status : 500;
  console.error('[api]', err.message);
  res.status(status || 500).json({ error: err.message });
}

app.listen(cfg.server.port, cfg.server.host, () => {
  const mode = cfg.canUseLiveApi ? 'LIVE GitHub API' : 'DEMO data (no token/target configured)';
  console.log(`\n  Copilot Usage Dashboard`);
  console.log(`  → http://${cfg.server.host}:${cfg.server.port}`);
  console.log(`  → mode: ${mode}\n`);
});
