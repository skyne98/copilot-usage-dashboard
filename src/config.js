// Loads and validates config.json. Falls back to config.example.json shape defaults.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  server: { host: '127.0.0.1', port: 3000 },
  github: { token: '', apiBaseUrl: 'https://api.github.com', apiVersion: '2022-11-28' },
  targets: { enterprise: '', organizations: [], teams: [] },
  defaults: { scope: 'enterprise', days: 28 },
  limits: {},
  useSampleDataFallback: true,
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (k.startsWith('//')) continue; // allow "//comment" keys in JSON
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(base?.[k] ?? {}, v);
    else out[k] = v;
  }
  return out;
}

export function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`config.json is not valid JSON: ${err.message}`);
    console.warn('[config] config.json not found — using defaults (demo mode).');
  }

  const cfg = deepMerge(DEFAULTS, fileCfg);

  // Normalize
  cfg.server.port = Number(cfg.server.port) || 3000;
  cfg.targets.organizations = (cfg.targets.organizations || []).filter(Boolean);
  cfg.targets.teams = (cfg.targets.teams || []).filter(Boolean);
  cfg.limits = (cfg.limits && typeof cfg.limits === 'object' && !Array.isArray(cfg.limits)) ? cfg.limits : {};

  // A "live" connection needs a token and at least one target.
  const hasTarget = Boolean(cfg.targets.enterprise) || cfg.targets.organizations.length > 0;
  cfg.canUseLiveApi = Boolean(cfg.github.token) && hasTarget;

  if (!cfg.canUseLiveApi && !cfg.useSampleDataFallback) {
    throw new Error(
      'No GitHub token/target configured and useSampleDataFallback is false. ' +
      'Add github.token + targets.enterprise (or organizations) to config.json, or enable useSampleDataFallback.'
    );
  }

  return cfg;
}
