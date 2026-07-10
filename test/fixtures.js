// Test fixtures — real-shape dashboard state for the chatbot engine.
// Mirrors the `state` object app.js builds (overview/billing/meta/users/source),
// sourced from the bundled sample-data.json so tests run against realistic data.

// readFileSync + JSON.parse (not an import attribute) so this works on Node 18+
// AND Bun — no `with { type: 'json' }` dependency. (Per PR #2 review.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(join(__dirname, '..', 'sample-data.json'), 'utf8'));

// The exact shape app.js hands to the chatbot: state.overview, state.billing,
// state.meta, state.users, state.source.
export const sampleState = {
  overview: sample.overview,
  billing: sample.billing,
  meta: sample.meta,
  users: sample.users,
  source: 'sample',
};

// Live-data variant (same numbers, but source flag differs so 'datasource' answers "live").
export const liveState = { ...sampleState, source: 'live' };

// A tiny hand-built state for predictable assertions (small, round numbers).
// Agentic shape: kpis has agentSessions (no acceptanceRate); users carry limit/overLimit.
export const tinyState = {
  meta: { creditUsd: 0.01, target: 'demo-org', windowDays: 7 },
  overview: {
    kpis: {
      activeUsers: 3, engagedUsers: 2, aiCredits: 500,
      agentSessions: 42, ideChats: 20, prSummaries: 5,
    },
    topModels: [{ name: 'GPT-4o', engagedUsers: 3, value: 10 }],
    featureSplit: [{ label: 'Chat', value: 20 }],
    series: { dates: ['d1', 'd2', 'd3'], activeUsers: [1, 2, 3] },
  },
  billing: {
    cycleStart: '2026-07-01', cycleEnd: '2026-07-31', seats: 3,
    includedQuantity: 100, includedPool: 200, additionalQuantity: 50, netAmountUsd: 0.5,
  },
  users: [
    { login: 'alice', name: 'Alice', aiCredits: 400, agentSessions: 5, limit: 500, overLimit: 0, pctOfLimit: 80, activeDays: 5, windowDays: 7, topModel: 'GPT-4o' },
    { login: 'bob', name: 'Bob', aiCredits: 100, agentSessions: 2, limit: 50, overLimit: 50, pctOfLimit: 200, activeDays: 2, windowDays: 7, topModel: 'Claude' },
  ],
  source: 'live',
};

// Empty ctx (no data fetched) — data intents should degrade gracefully.
export const emptyState = null;
