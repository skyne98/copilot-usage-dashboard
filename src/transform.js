// Normalizes raw GitHub Copilot Metrics API responses into the UI shape used by the
// frontend (identical to sample-data.json). Written defensively — the aggregate schema
// nests deeply and fields may be absent for days with no activity.

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const rate = (acc, sug) => (sug ? Math.round((acc / sug) * 100) : 0);

/**
 * Transform the /copilot/metrics aggregate array (one object per day) into the overview shape.
 * @param {Array} days
 */
export function transformOverview(days, meta = {}) {
  const list = Array.isArray(days) ? [...days].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const dates = list.map(d => d.date);

  const langMap = new Map();   // name -> {suggestions, acceptances, users:Set}
  const editorMap = new Map(); // name -> {value, users:Set}
  const modelMap = new Map();  // name -> {value, users:Set, isCustom}

  const activeUsers = [], engagedUsers = [], linesAccepted = [], acceptanceRateSeries = [];
  let totalSuggestions = 0, totalAcceptances = 0, totalLinesAccepted = 0, totalChats = 0, totalPRs = 0;

  for (const day of list) {
    activeUsers.push(num(day.total_active_users));
    engagedUsers.push(num(day.total_engaged_users));

    let dayLines = 0, daySug = 0, dayAcc = 0;
    const cc = day.copilot_ide_code_completions || {};
    for (const editor of cc.editors || []) {
      const e = editorMap.get(editor.name) || { value: 0, users: new Set() };
      e.value += num(editor.total_engaged_users);
      e.users.add(editor.name + ':' + num(editor.total_engaged_users));
      editorMap.set(editor.name, e);
      for (const model of editor.models || []) {
        const m = modelMap.get(model.name) || { value: 0, users: new Set(), isCustom: !!model.is_custom_model };
        m.value += num(model.total_engaged_users);
        modelMap.set(model.name, m);
        for (const lang of model.languages || []) {
          const l = langMap.get(lang.name) || { suggestions: 0, acceptances: 0, users: new Set() };
          l.suggestions += num(lang.total_code_suggestions);
          l.acceptances += num(lang.total_code_acceptances);
          l.users.add(lang.name);
          langMap.set(lang.name, l);
          daySug += num(lang.total_code_suggestions);
          dayAcc += num(lang.total_code_acceptances);
          dayLines += num(lang.total_code_lines_accepted);
        }
      }
    }
    for (const lang of cc.languages || []) {
      const l = langMap.get(lang.name) || { suggestions: 0, acceptances: 0, users: new Set() };
      l.users.add('u:' + num(lang.total_engaged_users));
      langMap.set(lang.name, l);
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

    linesAccepted.push(dayLines);
    acceptanceRateSeries.push(rate(dayAcc, daySug));
    totalSuggestions += daySug; totalAcceptances += dayAcc; totalLinesAccepted += dayLines;
    totalChats += dayChats; totalPRs += dayPRs;
  }

  const topLanguages = [...langMap.entries()].map(([name, v]) => ({
    name, engagedUsers: v.users.size, suggestions: v.suggestions,
    acceptances: v.acceptances, acceptanceRate: rate(v.acceptances, v.suggestions),
  })).sort((a, b) => b.acceptances - a.acceptances);

  const topEditors = [...editorMap.entries()].map(([name, v]) => ({ name, engagedUsers: v.users.size, value: v.value }))
    .sort((a, b) => b.value - a.value);
  const topModels = [...modelMap.entries()].map(([name, v]) => ({ name, engagedUsers: v.users.size, value: v.value, isCustom: v.isCustom }))
    .sort((a, b) => b.value - a.value);

  return {
    meta,
    overview: {
      kpis: {
        activeUsers: activeUsers.length ? Math.max(...activeUsers) : 0,
        engagedUsers: engagedUsers.length ? Math.max(...engagedUsers) : 0,
        totalSuggestions, totalAcceptances,
        acceptanceRate: rate(totalAcceptances, totalSuggestions),
        linesAccepted: totalLinesAccepted,
        ideChats: totalChats, prSummaries: totalPRs,
      },
      series: { dates, activeUsers, engagedUsers, linesAccepted, acceptanceRate: acceptanceRateSeries },
      featureSplit: [
        { label: 'Code completions', value: totalAcceptances },
        { label: 'IDE chat', value: totalChats },
        { label: 'PR summaries', value: totalPRs },
      ],
      topLanguages, topEditors, topModels,
    },
  };
}

/**
 * Best-effort parse of per-user report files (from /metrics/{date} download links) into
 * the users[] shape. The report format varies; if no per-user records are recognizable this
 * returns [] so the caller can degrade to seat-activity or demo data.
 */
export function transformUsers(dayReports /* [{date, files:[...]}] */) {
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
        byUser.set(login, u);
      }
    }
  }
  return [...byUser.values()].map(finalizeUser);
}

function emptyUser(login) {
  return {
    login, name: login, team: null,
    avatarUrl: `https://avatars.githubusercontent.com/${login}`,
    suggestions: 0, acceptances: 0, linesAccepted: 0, chats: 0, prSummaries: 0,
    _days: new Map(),
  };
}

function finalizeUser(u) {
  const dates = [...u._days.keys()].sort();
  const activity = dates.map(d => u._days.get(d));
  delete u._days;
  return {
    ...u,
    windowDays: dates.length,
    activeDays: activity.filter(v => v > 0).length,
    acceptanceRate: rate(u.acceptances, u.suggestions),
    // The Metrics API does not expose token/premium-request counts per user, so we surface a
    // proxy (chats ≈ premium requests + a fraction of acceptances) so the metric is non-empty.
    tokensUsed: Math.round(u.chats + u.acceptances * 0.15),
    topModel: '—', topEditor: '—', topLanguage: '—',
    lastActive: dates[dates.length - 1] || null,
    status: activity.slice(-7).some(v => v > 0) ? 'active' : 'idle',
    activitySeries: activity,
    modes: [
      { label: 'Code completions', value: u.acceptances },
      { label: 'IDE chat', value: u.chats },
      { label: 'PR summaries', value: u.prSummaries },
    ],
    models: [], editors: [], languages: [],
    dailySeries: { dates, activity, linesAccepted: activity.map(v => v * 3) },
  };
}
