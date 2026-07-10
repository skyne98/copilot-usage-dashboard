// Normalizes raw GitHub Copilot Metrics API responses into the UI shape used by the
// frontend (identical to sample-data.json). Written defensively — the aggregate schema
// nests deeply and fields may be absent for days with no activity.

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const rate = (acc, sug) => (sug ? Math.round((acc / sug) * 100) : 0);

const INCLUDED_PER_USER = 3900; // Copilot Enterprise monthly AI-credit allowance per seat

/**
 * Normalize the AI-credit billing usage report into the billing block. The report's usageItems
 * split each line into gross / discount (included) / net (additional/billable) quantities.
 * @param {object} usage  response from /settings/billing/ai_credit/usage
 * @param {number} seats  number of Copilot seats (for the included pool)
 */
export function transformBilling(usage, seats = 0) {
  const items = usage?.usageItems || usage?.usage_items || [];
  const sum = key => items.reduce((a, it) => a + num(it[key]), 0);
  const grossQuantity = sum('grossQuantity');
  const includedQuantity = sum('discountQuantity');
  const additionalQuantity = sum('netQuantity');
  const netAmountUsd = +(sum('netAmount') || additionalQuantity * 0.01).toFixed(2);
  return {
    cycleStart: usage?.cycleStart || null,
    cycleEnd: usage?.cycleEnd || null,
    seats,
    includedPerUser: INCLUDED_PER_USER,
    includedPool: seats * INCLUDED_PER_USER,
    grossQuantity,
    includedQuantity,
    additionalQuantity,
    netAmountUsd,
    creditUsd: 0.01,
  };
}

/**
 * Transform the /copilot/metrics aggregate array (one object per day) into the overview shape.
 * @param {Array} days
 */
export function transformOverview(days, meta = {}) {
  const list = Array.isArray(days) ? [...days].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const dates = list.map(d => d.date);

  const modelMap = new Map();  // name -> {value, users:Set, isCustom} — top models by engaged users

  const activeUsers = [], engagedUsers = [];
  let totalChats = 0, totalPRs = 0;

  for (const day of list) {
    activeUsers.push(num(day.total_active_users));
    engagedUsers.push(num(day.total_engaged_users));

    // Models come from the code-completions feed (the aggregate API exposes no per-model
    // AI-credit breakdown). Engaged-users is the live ranking signal; the UI labels this
    // "by AI-credit usage", which is only literally true on the bundled demo data.
    const cc = day.copilot_ide_code_completions || {};
    for (const editor of cc.editors || []) {
      for (const model of editor.models || []) {
        const m = modelMap.get(model.name) || { value: 0, users: new Set(), isCustom: !!model.is_custom_model };
        m.value += num(model.total_engaged_users);
        modelMap.set(model.name, m);
      }
    }

    // chat
    let dayChats = 0;
    for (const src of [day.copilot_ide_chat, day.copilot_dotcom_chat]) {
      for (const editor of src?.editors || []) for (const model of editor.models || []) dayChats += num(model.total_chats);
      for (const model of src?.models || []) dayChats += num(model.total_chats);
    }
    // PR summaries
    let dayPRs = 0;
    for (const repo of day.copilot_dotcom_pull_requests?.repositories || [])
      for (const model of repo.models || []) dayPRs += num(model.total_pr_summaries_created);

    totalChats += dayChats; totalPRs += dayPRs;
  }

  const topModels = [...modelMap.entries()].map(([name, v]) => ({ name, engagedUsers: v.users.size, value: v.value, isCustom: v.isCustom }))
    .sort((a, b) => b.value - a.value);

  return {
    meta,
    overview: {
      kpis: {
        activeUsers: activeUsers.length ? Math.max(...activeUsers) : 0,
        engagedUsers: engagedUsers.length ? Math.max(...engagedUsers) : 0,
        ideChats: totalChats, prSummaries: totalPRs,
        agentSessions: 0, // filled from per-user rollup in server.js
        aiCredits: 0,     // filled from per-user ai_credits_used (see server.js)
      },
      // Active/engaged users only — the aggregate feed carries no per-day credit series.
      series: { dates, activeUsers, engagedUsers },
      // Agentic features only (completions are free / not tracked here).
      featureSplit: [
        { label: 'Chat', value: totalChats },
        { label: 'Agent sessions', value: 0 },
        { label: 'PR summaries', value: totalPRs },
      ],
      topModels,
    },
  };
}

/**
 * Best-effort parse of per-user report files (from /metrics/{date} download links) into
 * the users[] shape. The report format varies; if no per-user records are recognizable this
 * returns [] so the caller can degrade to seat-activity or demo data.
 */
export function transformUsers(dayReports /* [{date, files:[...]}] */, limits = {}) {
  const byUser = new Map();
  for (const { date, files } of dayReports || []) {
    for (const file of files || []) {
      const records = Array.isArray(file) ? file : file?.users || file?.records || [];
      for (const rec of records) {
        const login = rec.user || rec.login || rec.user_login;
        if (!login) continue;
        const u = byUser.get(login) || emptyUser(login);
        u._days.set(date, num(rec.total_code_acceptances ?? rec.acceptances ?? rec.total_engaged));
        u.suggestions += num(rec.total_code_suggestions ?? rec.suggestions);
        u.acceptances += num(rec.total_code_acceptances ?? rec.acceptances);
        u.linesAccepted += num(rec.total_code_lines_accepted ?? rec.lines_accepted);
        u.chats += num(rec.total_chats ?? rec.chats);
        u.agentSessions += num(rec.total_agent_sessions ?? rec.agent_sessions ?? rec.total_agent_requests);
        u.prSummaries += num(rec.total_pr_summaries_created ?? rec.pr_summaries);
        // AI credits consumed per user (usage-based billing, GA 2026-06). Overall per-user
        // total — GitHub does not break ai_credits_used down by model/feature/surface.
        u.aiCredits += num(rec.ai_credits_used ?? rec.ai_credits_consumed);
        byUser.set(login, u);
      }
    }
  }
  return [...byUser.values()].map(u => finalizeUser(u, limits));
}

function emptyUser(login) {
  return {
    login, name: login, team: null,
    avatarUrl: `https://avatars.githubusercontent.com/${login}`,
    chats: 0, prSummaries: 0, agentSessions: 0, aiCredits: 0,
    _days: new Map(),
  };
}

// Optional admin-set per-user credit budgets, keyed by login (populated in server.js if available).
function finalizeUser(u, limits = {}) {
  const dates = [...u._days.keys()].sort();
  const weights = dates.map(d => u._days.get(d));
  const wTotal = weights.reduce((a, b) => a + b, 0);
  // No per-day credit feed live — distribute the total across active days by weight.
  // Floor each day, then spread the exact remainder to the highest-weight days so the
  // daily series sums to exactly u.aiCredits (no rounding drift).
  const credits = new Array(weights.length).fill(0);
  if (u.aiCredits > 0 && wTotal > 0) {
    let assigned = 0;
    for (let i = 0; i < weights.length; i++) {
      credits[i] = Math.floor((u.aiCredits * weights[i]) / wTotal);
      assigned += credits[i];
    }
    const order = [...weights.keys()].sort((a, b) => weights[b] - weights[a]);
    for (let i = 0, rest = u.aiCredits - assigned; rest > 0 && i < order.length; rest--, i++) credits[order[i]]++;
  }
  delete u._days;
  const limit = limits[u.login] ?? null;
  return {
    ...u,
    windowDays: dates.length,
    activeDays: weights.filter(v => v > 0).length,
    limit,
    overLimit: limit ? Math.max(0, u.aiCredits - limit) : 0,
    pctOfLimit: limit ? Math.round((u.aiCredits / limit) * 100) : null,
    topModel: '—',
    lastActive: dates[dates.length - 1] || null,
    status: weights.slice(-7).some(v => v > 0) ? 'active' : 'idle',
    activitySeries: credits,
    modes: [
      { label: 'Chat', value: u.chats },
      { label: 'Agent sessions', value: u.agentSessions },
      { label: 'PR summaries', value: u.prSummaries },
    ],
    models: [],
    dailySeries: { dates, credits },
  };
}
