import { sparkline, lineChart, barList, donut, fmt, CATEGORICAL, ACCENT } from './charts.js';

const $ = sel => document.querySelector(sel);
const el = id => document.getElementById(id);

const state = {
  cfg: null,
  overview: null,
  users: [],
  source: null,
  search: '',
  sort: 'tokens',
};

// ---------- theme ----------
const themeToggle = el('themeToggle');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeToggle.textContent = t === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('theme', t);
}
themeToggle.addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
applyTheme(localStorage.getItem('theme') || 'dark');

// ---------- helpers ----------
async function api(path) {
  const res = await fetch(path);
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
    state.meta = ov.meta;
    state.users = us.users || [];
    state.source = ov.source;
    handleSource(ov);
    renderOverview();
    renderUsers();
  } catch (e) {
    setError(e.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector('.spin')?.remove();
    fetchBtn.querySelector('.btn-label').textContent = 'Fetch usage';
  }
}
fetchBtn.addEventListener('click', fetchAll);

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
    { label: 'Tokens used', value: fmt(k.tokensUsed || 0), sub: 'premium requests' },
    { label: 'Acceptance rate', value: k.acceptanceRate + '%', sub: `${fmt(k.totalAcceptances)} accepted` },
    { label: 'Lines accepted', value: fmt(k.linesAccepted), sub: `of ${fmt(k.totalSuggestions)} suggestions` },
    { label: 'IDE chats', value: fmt(k.ideChats), sub: 'chat interactions' },
  ];
  el('kpiGrid').innerHTML = kpis.map(x => `
    <div class="card kpi">
      <div class="k-label">${x.label}</div>
      <div class="k-value">${x.value}</div>
      <div class="k-sub">${x.sub}</div>
      <div class="k-accent"></div>
    </div>`).join('');

  const s = o.series;
  el('usersChart').innerHTML = lineChart(s.dates, [
    { name: 'Active', values: s.activeUsers, color: CATEGORICAL[0], area: true },
    { name: 'Engaged', values: s.engagedUsers, color: CATEGORICAL[1] },
  ]);
  el('usersLegend').innerHTML = legend([['Active', CATEGORICAL[0]], ['Engaged', CATEGORICAL[1]]]);

  el('linesChart').innerHTML = lineChart(s.dates, [
    { name: 'Lines accepted', values: s.linesAccepted, color: ACCENT, area: true },
  ]);
  el('linesLegend').innerHTML = legend([['Lines accepted', ACCENT]]);

  el('featureDonut').innerHTML = donut(o.featureSplit, { valueKey: 'value', labelKey: 'label' });
  el('modelBars').innerHTML = barList(o.topModels.slice(0, 6).map(m => ({ name: m.name, value: m.engagedUsers })), { colorByIndex: true });
  el('editorBars').innerHTML = barList(o.topEditors.slice(0, 6).map(e => ({ name: e.name, value: e.engagedUsers })), { colorByIndex: true });
  el('languageBars').innerHTML = barList(
    o.topLanguages.slice(0, 8).map(l => ({ name: l.name, value: l.acceptances, sub: l.acceptanceRate + '%' })),
    { format: fmt }
  );
}
function legend(pairs) {
  return pairs.map(([name, c]) => `<span><i style="background:${c}"></i>${name}</span>`).join('');
}

// ---------- Tier 2: users list ----------
el('userSearch').addEventListener('input', e => { state.search = e.target.value.toLowerCase(); renderUsers(); });
el('userSort').addEventListener('change', e => { state.sort = e.target.value; renderUsers(); });

function sortedFilteredUsers() {
  let list = state.users.filter(u =>
    !state.search || u.login.toLowerCase().includes(state.search) || (u.name || '').toLowerCase().includes(state.search));
  const cmp = {
    tokens: (a, b) => (b.tokensUsed || 0) - (a.tokensUsed || 0),
    activity: (a, b) => b.activeDays - a.activeDays,
    acceptance: (a, b) => b.acceptanceRate - a.acceptanceRate,
    lines: (a, b) => b.linesAccepted - a.linesAccepted,
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
      ${sparkline(u.activitySeries || [], { width: 236, height: 34 })}
      <div class="u-metrics">
        <div class="u-metric"><div class="m-v">${fmt(u.tokensUsed || 0)}</div><div class="m-l">tokens</div></div>
        <div class="u-metric"><div class="m-v">${u.activeDays}/${u.windowDays}</div><div class="m-l">active days</div></div>
        <div class="u-metric"><div class="m-v">${u.acceptanceRate}%</div><div class="m-l">accept rate</div></div>
      </div>
      <div class="u-foot">
        <div class="chips"><span class="chip">${u.topModel}</span><span class="chip">${u.topEditor}</span></div>
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
  const hasDetail = (u.models?.length || u.editors?.length || u.languages?.length);
  const view = el('detailView');
  const ds = u.dailySeries || { dates: [], activity: [], linesAccepted: [] };
  view.innerHTML = `
    <button class="back-btn" id="backBtn">← Back to overview</button>
    <div class="detail-head">
      <img class="avatar" src="${u.avatarUrl}" alt="" onerror="this.style.visibility='hidden'"/>
      <div>
        <h2>${u.name || u.login}</h2>
        <div class="d-sub">@${u.login}${u.team ? ' · ' + u.team : ''} · <span class="badge ${u.status}">${u.status}</span></div>
      </div>
      <div class="detail-stats">
        <div class="ds"><div class="v">${fmt(u.tokensUsed || 0)}</div><div class="l">Tokens used</div></div>
        <div class="ds"><div class="v">${u.activeDays}/${u.windowDays}</div><div class="l">Active days</div></div>
        <div class="ds"><div class="v">${u.acceptanceRate}%</div><div class="l">Accept rate</div></div>
        <div class="ds"><div class="v">${fmt(u.linesAccepted)}</div><div class="l">Lines accepted</div></div>
        <div class="ds"><div class="v">${fmt(u.chats)}</div><div class="l">Chats</div></div>
      </div>
    </div>

    <section class="section">
      <div class="card">
        <h3>Activity over time</h3>
        <p class="card-sub">Daily code acceptances across the window</p>
        <div id="d-activity"></div>
      </div>
    </section>

    ${hasDetail ? `
    <section class="section">
      <div class="grid charts-3">
        <div class="card"><h3>Modes of usage</h3><p class="card-sub">How this user works with Copilot</p><div id="d-modes"></div></div>
        <div class="card"><h3>Models used</h3><p class="card-sub">Tokens consumed per model</p><div id="d-models"></div></div>
        <div class="card"><h3>Editors</h3><p class="card-sub">Where they code</p><div id="d-editors"></div></div>
      </div>
    </section>
    <section class="section">
      <div class="card"><h3>Languages</h3><p class="card-sub">Acceptances &amp; acceptance rate</p><div id="d-langs"></div></div>
    </section>` : `
    <section class="section"><div class="card"><p class="muted">Detailed per-mode / model / language breakdown isn't available for this user — only aggregate activity was reported.</p></div></section>`}
  `;

  el('backBtn').addEventListener('click', closeDetail);
  el('d-activity').innerHTML = lineChart(ds.dates, [
    { name: 'Acceptances', values: ds.activity, color: ACCENT, area: true },
  ]);
  if (hasDetail) {
    el('d-modes').innerHTML = donut(u.modes, { valueKey: 'value', labelKey: 'label', size: 170, thickness: 26 });
    el('d-models').innerHTML = barList(
      u.models.map(m => ({ name: m.name, value: m.tokens ?? m.value, sub: `${fmt(m.value)} acc` })),
      { colorByIndex: true });
    el('d-editors').innerHTML = barList(u.editors.map(e => ({ name: e.name, value: e.value })), { colorByIndex: true });
    el('d-langs').innerHTML = barList(
      u.languages.map(l => ({ name: l.name, value: l.acceptances, sub: l.acceptanceRate + '%' })), { format: fmt });
  }
}

init();
