// Thin GitHub Copilot Metrics API client. Node 18+ (global fetch).
export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function createClient(cfg) {
  const base = (cfg.github.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${cfg.github.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': cfg.github.apiVersion || '2022-11-28',
    'User-Agent': 'copilot-usage-dashboard',
  };

  async function get(path, { raw = false } = {}) {
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const res = await fetch(url, { headers: path.startsWith('http') ? undefined : headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GitHubError(friendlyError(res.status, body), res.status);
    }
    return raw ? res.text() : res.json();
  }

  // Resolve scope -> metrics base path
  function metricsPath(scope, org) {
    if (scope === 'org') {
      if (!org) throw new GitHubError('An organization is required for org scope', 400);
      return `/orgs/${encodeURIComponent(org)}/copilot`;
    }
    if (!cfg.targets.enterprise) throw new GitHubError('No enterprise configured', 400);
    return `/enterprises/${encodeURIComponent(cfg.targets.enterprise)}/copilot`;
  }

  return {
    // 28-day aggregate metrics (array of daily objects)
    getMetrics: (scope, org) => get(`${metricsPath(scope, org)}/metrics`),

    // Granular daily report — returns { download_links, report_day, ... }; follow the links.
    async getDayReport(scope, org, date) {
      const meta = await get(`${metricsPath(scope, org)}/metrics/${date}`);
      const links = meta.download_links || [];
      const files = await Promise.all(
        links.map(async link => {
          const text = await get(link, { raw: true });
          try { return JSON.parse(text); } catch { return { _rawCsv: text }; }
        })
      );
      return { meta, files };
    },

    // user<->team membership for a day
    getTeams: (scope, org, date) => get(`${metricsPath(scope, org)}/metrics/teams${date ? `?date=${date}` : ''}`),

    // Billing usage for AI credits — carries the included (discount) vs additional (net) split.
    // Different endpoint/scope than metrics: /{orgs|enterprises}/{x}/settings/billing/ai_credit/usage
    getAiCreditUsage(scope, org) {
      const owner = scope === 'org'
        ? `/orgs/${encodeURIComponent(org)}`
        : `/enterprises/${encodeURIComponent(cfg.targets.enterprise)}`;
      return get(`${owner}/settings/billing/ai_credit/usage`);
    },
  };
}

function friendlyError(status, body) {
  const snippet = (body || '').slice(0, 200);
  switch (status) {
    case 401: return 'GitHub rejected the token (401). Check github.token in config.json.';
    case 403: return 'Forbidden (403). The token is missing the Copilot metrics permission/scope, or metrics are disabled.';
    case 404: return 'Not found (404). Check the enterprise/org slug and that Copilot metrics are enabled.';
    case 422: return `Unprocessable (422). ${snippet}`;
    default: return `GitHub API error ${status}. ${snippet}`;
  }
}
