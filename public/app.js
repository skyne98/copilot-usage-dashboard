import { sparkline, lineChart, barList, donut, progressBar, mountCharts, fmt, CATEGORICAL, ACCENT } from './charts.js';

const el = id => document.getElementById(id);

const state = {
  cfg: null,
  overview: null,
  billing: null,
  users: [],
  teamCredits: 0,
  source: null,
  search: '',
  sort: 'credits',
};

// ---------- helpers ----------
async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
function scopeQuery() {
  const scope = el('scope').value;
  const org = el('org').value;
  return `scope=${scope}${scope === 'org' && org ? `&org=${encodeURIComponent(org)}` : ''}`;
}
function showBanner(id, show) { el(id).classList.toggle('show', show); }
// AI credits → USD (1 credit = $0.01). Compact for large amounts.
const usd = credits => {
  const d = (Number(credits) || 0) * (state.meta?.creditUsd ?? 0.01);
  return d >= 1000 ? '$' + (d / 1000).toFixed(1) + 'k' : '$' + d.toFixed(d < 10 ? 2 : 0);
};
function setError(msg) { el('errorMsg').textContent = msg; showBanner('errorBanner', !!msg); }

// ---------- init ----------
async function init() {
  try {
    const cfg = await api('/api/config');
    state.cfg = cfg;
    el('scope').value = cfg.scope || 'enterprise';
    if (cfg.organizations?.length) {
      el('org').innerHTML = cfg.organizations.map(o => `<option value="${o}">${o}</option>`).join('');
    }
    syncScopeUI();
  } catch (e) { setError(e.message); }
  // Auto-load once so the dashboard is never empty on first paint.
  fetchAll();
}
function syncScopeUI() {
  const isOrg = el('scope').value === 'org';
  el('orgField').style.display = isOrg ? '' : 'none';
  el('org').disabled = !isOrg;
}
el('scope').addEventListener('change', syncScopeUI);

// ---------- fetch ----------
const fetchBtn = el('fetchBtn');
async function fetchAll() {
  setError('');
  fetchBtn.disabled = true;
  fetchBtn.querySelector('.btn-label').textContent = 'Fetching…';
  fetchBtn.insertAdjacentHTML('afterbegin', '<span class="spin"></span>');
  showSkeletons();
  try {
    const q = scopeQuery();
    const [ov, us] = await Promise.all([api(`/api/overview?${q}`), api(`/api/users?${q}`)]);
    state.overview = ov.overview;
    state.billing = ov.billing || null;
    state.meta = ov.meta;
    state.users = us.users || [];
    state.teamCredits = state.users.reduce((a, u) => a + (u.aiCredits || 0), 0);
    state.source = ov.source;
    handleSource(ov);
    renderOverview();
    renderUsers();
    mountCharts();
    saveSnapshot(ov, us);
  } catch (e) {
    setError(e.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector('.spin')?.remove();
    fetchBtn.querySelector('.btn-label').textContent = 'Fetch usage';
  }
}
fetchBtn.addEventListener('click', fetchAll);

// persist the pulled usage to the server-side JSON store (add-or-update by date)
async function saveSnapshot(ov, us) {
  const status = el('snapshotStatus');
  try {
    const r = await api('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: ov.meta?.endDate,
        meta: ov.meta, billing: ov.billing, overview: ov.overview, users: us.users || [],
        source: ov.source,
      }),
    });
    if (status) status.textContent = `💾 Saved snapshot for ${r.date} · ${r.count} on file`;
  } catch (e) {
    if (status) status.textContent = `Snapshot not saved: ${e.message}`;
  }
}

function handleSource(ov) {
  const demo = ov.source === 'sample';
  showBanner('demoBanner', demo);
  if (demo && ov.sampleReason) {
    el('demoReason').textContent = `Live API call failed (${ov.sampleReason}) — showing sample data.`;
  }
  const m = state.meta || {};
  el('metaLabel').textContent = m.target ? `· ${m.target} · ${m.windowDays || ''}-day window` : '';
}

function showSkeletons() {
  el('kpiGrid').innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton" style="min-height:104px"></div>').join('');
}

// ---------- Tier 1: overview ----------
function renderOverview() {
  const o = state.overview;
  if (!o) return;
  const k = o.kpis;
  const kpis = [
    { label: 'Active users', value: fmt(k.activeUsers), sub: `${k.engagedUsers} engaged` },
    { label: 'AI credits used', value: fmt(k.aiCredits || 0), sub: `≈ ${usd(k.aiCredits || 0)} · AIC` },
    { label: 'Agent sessions', value: fmt(k.agentSessions || 0), sub: 'autonomous runs' },
    { label: 'Chats', value: fmt(k.ideChats), sub: 'chat interactions' },
    { label: 'PR summaries', value: fmt(k.prSummaries), sub: 'generated' },
  ];
  el('kpiGrid').innerHTML = kpis.map(x => `
    <div class="card kpi">
      <div class="k-label">${x.label}</div>
      <div class="k-value">${x.value}</div>
      <div class="k-sub">${x.sub}</div>
      <div class="k-accent"></div>
    </div>`).join('');

  renderBilling();

  const s = o.series;
  el('usersChart').innerHTML = lineChart(s.dates, [
    { name: 'Active', values: s.activeUsers, color: CATEGORICAL[0], area: true },
    { name: 'Engaged', values: s.engagedUsers, color: CATEGORICAL[1] },
  ]);
  el('usersLegend').innerHTML = legend([['Active', CATEGORICAL[0]], ['Engaged', CATEGORICAL[1]]]);

  el('featureDonut').innerHTML = donut(o.featureSplit, { valueKey: 'value', labelKey: 'label' });
  el('modelBars').innerHTML = barList(
    o.topModels.slice(0, 6).map(m => ({ name: m.name, value: m.value })), { colorByIndex: true, format: fmt });
}
function legend(pairs) {
  return pairs.map(([name, c]) => `<span><i style="background:${c}"></i>${name}</span>`).join('');
}

// each user's share of the team's total AI credits
function pctOfTeam(u) {
  return state.teamCredits ? Math.round(((u.aiCredits || 0) / state.teamCredits) * 100) : 0;
}

// per-user credit-limit tag: over-limit (red) or % of limit
function limitTag(u) {
  if (u.limit == null) return `<span class="chip">no limit</span>`;
  if ((u.overLimit || 0) > 0) return `<span class="chip over">over limit +${fmt(u.overLimit)}</span>`;
  return `<span class="chip">${u.pctOfLimit}% of ${fmt(u.limit)}</span>`;
}

function renderBilling() {
  const b = state.billing;
  const card = el('billingCard');
  if (!b) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const cycle = b.cycleStart && b.cycleEnd ? `${b.cycleStart} – ${b.cycleEnd}` : 'current cycle';
  el('billingSub').textContent = `Cycle ${cycle} · ${b.seats} seats · all Copilot features`;
  el('billingBody').innerHTML = `
    ${progressBar(b.grossQuantity, b.includedPool)}
    <div class="bill-readout">
      <div class="bill-stat"><div class="v">${fmt(b.includedQuantity)}</div><div class="l">Included (of ${fmt(b.includedPool)})</div></div>
      <div class="bill-stat"><div class="v">${fmt(b.additionalQuantity)}</div><div class="l">Additional</div></div>
      <div class="bill-stat over"><div class="v">$${(b.netAmountUsd ?? 0).toFixed(2)}</div><div class="l">Billed</div></div>
    </div>`;
}

// ---------- Tier 2: users list ----------
el('userSearch').addEventListener('input', e => { state.search = e.target.value.toLowerCase(); renderUsers(); });
el('userSort').addEventListener('change', e => { state.sort = e.target.value; renderUsers(); });

function sortedFilteredUsers() {
  let list = state.users.filter(u =>
    !state.search || u.login.toLowerCase().includes(state.search) || (u.name || '').toLowerCase().includes(state.search));
  const cmp = {
    credits: (a, b) => (b.aiCredits || 0) - (a.aiCredits || 0),
    overlimit: (a, b) => (b.overLimit || 0) - (a.overLimit || 0) || (b.pctOfLimit || 0) - (a.pctOfLimit || 0),
    agent: (a, b) => (b.agentSessions || 0) - (a.agentSessions || 0),
    activity: (a, b) => b.activeDays - a.activeDays,
    name: (a, b) => (a.name || a.login).localeCompare(b.name || b.login),
  }[state.sort];
  return list.sort(cmp);
}

function renderUsers() {
  const list = sortedFilteredUsers();
  const empty = el('usersEmpty');
  if (!state.users.length) {
    el('userGrid').innerHTML = '';
    empty.textContent = state.meta?.usersDegraded
      ? 'Per-user data is not available for this target (report lacks per-user granularity).'
      : 'No user data.';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.toggle('hidden', list.length > 0);
  if (!list.length) empty.textContent = 'No users match your search.';

  el('userGrid').innerHTML = list.map(u => `
    <button class="card user-card" data-login="${u.login}">
      <div class="user-head">
        <img class="avatar" src="${u.avatarUrl}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>
        <div>
          <div class="u-name">${u.name || u.login}</div>
          <div class="u-login">@${u.login}${u.team ? ' · ' + u.team : ''}</div>
        </div>
        <span class="badge ${u.status}">${u.status}</span>
      </div>
      ${sparkline(u.activitySeries || [], { width: 210, height: 26 })}
      <div class="u-metrics">
        <div class="u-metric"><div class="m-v">${fmt(u.aiCredits || 0)}</div><div class="m-l">AI credits</div></div>
        <div class="u-metric"><div class="m-v">${fmt(u.agentSessions || 0)}</div><div class="m-l">agent</div></div>
        <div class="u-metric"><div class="m-v">${pctOfTeam(u)}%</div><div class="m-l">of team</div></div>
      </div>
      <div class="u-foot">
        ${limitTag(u)}
        <span>${usd(u.aiCredits || 0)}</span>
      </div>
    </button>`).join('');

  el('userGrid').querySelectorAll('.user-card').forEach(card =>
    card.addEventListener('click', () => openUser(card.dataset.login)));
}

// ---------- Tier 3: user detail ----------
async function openUser(login) {
  try {
    // The users list already carries full per-user detail, so open instantly from cache —
    // no extra request. Fall back to the API only if a cached user somehow lacks detail.
    let user = state.users.find(u => u.login === login);
    if (!user || !user.dailySeries) {
      const data = await api(`/api/users/${encodeURIComponent(login)}?${scopeQuery()}`);
      user = data.user;
    }
    renderDetail(user);
    mountCharts(el('detailView'));
    el('overviewView').classList.add('hidden');
    el('detailView').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { setError(e.message); }
}
function closeDetail() {
  el('detailView').classList.add('hidden');
  el('overviewView').classList.remove('hidden');
}

function renderDetail(u) {
  const hasDetail = (u.models?.length || u.modes?.length);
  const view = el('detailView');
  const ds = u.dailySeries || { dates: [], credits: [] };
  const overStat = u.limit == null
    ? `<div class="ds"><div class="v">—</div><div class="l">No limit set</div></div>`
    : (u.overLimit > 0
        ? `<div class="ds over"><div class="v">+${fmt(u.overLimit)}</div><div class="l">Over limit</div></div>`
        : `<div class="ds"><div class="v">${u.pctOfLimit}%</div><div class="l">of limit</div></div>`);
  view.innerHTML = `
    <button class="back-btn" id="backBtn">← Back to overview</button>
    <div class="detail-head">
      <img class="avatar" src="${u.avatarUrl}" alt="" onerror="this.style.visibility='hidden'"/>
      <div>
        <h2>${u.name || u.login}</h2>
        <div class="d-sub">@${u.login}${u.team ? ' · ' + u.team : ''} · <span class="badge ${u.status}">${u.status}</span></div>
      </div>
      <div class="detail-stats">
        <div class="ds"><div class="v">${fmt(u.aiCredits || 0)}</div><div class="l">AI credits · ${usd(u.aiCredits || 0)}</div></div>
        <div class="ds"><div class="v">${u.limit == null ? '—' : fmt(u.limit)}</div><div class="l">Limit</div></div>
        ${overStat}
        <div class="ds"><div class="v">${pctOfTeam(u)}%</div><div class="l">of team</div></div>
        <div class="ds"><div class="v">${fmt(u.agentSessions || 0)}</div><div class="l">Agent sessions</div></div>
        <div class="ds"><div class="v">${fmt(u.chats)}</div><div class="l">Chats</div></div>
      </div>
    </div>

    <section class="section">
      <div class="card">
        <h3>Used tokens over time</h3>
        <p class="card-sub">Daily AI-credit consumption across the window${u.limit != null ? ` · limit ${fmt(u.limit)}` : ''}</p>
        <div id="d-tokens"></div>
      </div>
    </section>

    ${hasDetail ? `
    <section class="section">
      <div class="grid charts-2">
        <div class="card"><h3>Agentic modes</h3><p class="card-sub">Chat · agent sessions · PR summaries</p><div id="d-modes"></div></div>
        <div class="card"><h3>Models used</h3><p class="card-sub">By AI-credit usage</p><div id="d-models"></div></div>
      </div>
    </section>` : `
    <section class="section"><div class="card"><p class="muted">Detailed breakdown isn't available for this user — only aggregate usage was reported.</p></div></section>`}
  `;

  el('backBtn').addEventListener('click', closeDetail);
  el('d-tokens').innerHTML = lineChart(ds.dates, [
    { name: 'AI credits', values: ds.credits, color: ACCENT, area: true },
  ]);
  if (hasDetail) {
    el('d-modes').innerHTML = donut(u.modes, { valueKey: 'value', labelKey: 'label', size: 150, thickness: 24 });
    el('d-models').innerHTML = barList(u.models.map(m => ({ name: m.name, value: m.value })), { colorByIndex: true, format: fmt });
  }
}

init();
