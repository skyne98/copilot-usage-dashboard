// Dependency-free SVG charts with a Win2K look + interactive hover (crosshair / tooltip).
// Classic VGA categorical palette, readable on the white sunken chart client area.

export const CATEGORICAL = ['#000080', '#008080', '#800000', '#808000', '#800080', '#008000', '#808080', '#c05000'];
export const ACCENT = '#000080';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
};

// ---- interactivity registry: chartId -> geometry + data (populated by lineChart) ----
const registry = new Map();
let uid = 0;

// ---- shared tooltip ----
function tip() { return document.getElementById('chartTooltip'); }
function showTip(html, x, y) {
  const t = tip(); if (!t) return;
  t.innerHTML = html;
  t.style.display = 'block';
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let left = x + pad, top = y + pad;
  if (left + w > window.innerWidth) left = x - w - pad;
  if (top + h > window.innerHeight) top = y - h - pad;
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
function hideTip() { const t = tip(); if (t) t.style.display = 'none'; }

// ---- Sparkline (static) ----
export function sparkline(values, { width = 120, height = 26, color = ACCENT } = {}) {
  const v = values.length ? values : [0];
  const max = Math.max(...v, 1), min = Math.min(...v, 0), span = max - min || 1;
  const step = width / Math.max(v.length - 1, 1);
  const pts = v.map((val, i) => [i * step, height - ((val - min) / span) * (height - 3) - 1.5]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} L ${width} ${height} L 0 ${height} Z" fill="${color}" opacity="0.14"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

// ---- Line chart (interactive) ----
export function lineChart(dates, series, { height = 170, yFormat = fmt } = {}) {
  const id = 'lc' + (++uid);
  const W = 720, H = height, pad = { l: 42, r: 12, t: 12, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(...series.flatMap(s => s.values), 1);
  const n = dates.length;
  const x = i => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = val => pad.t + ih - (val / max) * ih;

  let grid = '';
  const gridY = 4;
  for (let g = 0; g <= gridY; g++) {
    const gy = pad.t + (g / gridY) * ih;
    grid += `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" class="grid"/>
      <text x="${pad.l - 6}" y="${(gy + 3).toFixed(1)}" class="axis" text-anchor="end">${yFormat(max * (1 - g / gridY))}</text>`;
  }
  let xlabels = '';
  [0, Math.floor((n - 1) / 2), n - 1].forEach(i => {
    if (i < 0 || i >= n) return;
    xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="axis" text-anchor="middle">${esc((dates[i] || '').slice(5))}</text>`;
  });
  const paths = series.map((s, si) => {
    const color = s.color || CATEGORICAL[si % CATEGORICAL.length];
    const d = s.values.map((val, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1)).join(' ');
    const area = s.area ? `<path d="${d} L ${x(n - 1)} ${pad.t + ih} L ${x(0)} ${pad.t + ih} Z" fill="${color}" opacity="0.12"/>` : '';
    return `${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75"/>`;
  }).join('');

  registry.set(id, {
    dates, series, max,
    x0: pad.l, x1: W - pad.r, yTop: pad.t, yBot: pad.t + ih, n,
    xOf: i => x(i), yOf: v => y(v),
  });

  return `<svg class="chart" id="${id}" data-chart="${id}" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">
    ${grid}${xlabels}${paths}
    <g class="hover-layer" style="display:none">
      <line class="crosshair" y1="${pad.t}" y2="${pad.t + ih}"/>
      ${series.map((s, si) => `<circle class="hdot" data-si="${si}" r="3.5" fill="${s.color || CATEGORICAL[si % CATEGORICAL.length]}"/>`).join('')}
    </g>
    <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>
  </svg>`;
}

// ---- Horizontal bar ranking (interactive) ----
export function barList(items, { valueKey = 'value', labelKey = 'name', max: fixedMax, format = fmt, colorByIndex = false } = {}) {
  if (!items.length) return `<p class="muted">No data.</p>`;
  const max = fixedMax || Math.max(...items.map(i => i[valueKey]), 1);
  return `<div class="barlist">` + items.map((it, i) => {
    const pct = (it[valueKey] / max) * 100;
    const color = colorByIndex ? CATEGORICAL[i % CATEGORICAL.length] : ACCENT;
    const sub = it.sub != null ? `<span class="bar-sub">${esc(it.sub)}</span>` : '';
    return `<div class="bar-row" data-tip="${esc(it[labelKey])}: ${esc(format(it[valueKey]))}">
      <div class="bar-label" title="${esc(it[labelKey])}">${esc(it[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <div class="bar-val">${format(it[valueKey])}${sub}</div>
    </div>`;
  }).join('') + `</div>`;
}

// ---- Donut (interactive) ----
export function donut(items, { size = 150, thickness = 24, valueKey = 'value', labelKey = 'label' } = {}) {
  const total = items.reduce((a, b) => a + (b[valueKey] || 0), 0) || 1;
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let offset = 0;
  const rings = items.map((it, i) => {
    const frac = (it[valueKey] || 0) / total;
    const color = CATEGORICAL[i % CATEGORICAL.length];
    const seg = `<circle class="donut-seg" data-tip="${esc(it[labelKey])}: ${fmt(it[valueKey] || 0)} (${Math.round(frac * 100)}%)"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${thickness}"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset * C).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += frac;
    return seg;
  }).join('');
  const legend = items.map((it, i) =>
    `<li><span class="dot-swatch" style="background:${CATEGORICAL[i % CATEGORICAL.length]}"></span>${esc(it[labelKey])}<b>${Math.round(((it[valueKey] || 0) / total) * 100)}%</b></li>`
  ).join('');
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${thickness}"/>
      ${rings}
      <text x="${cx}" y="${cy - 1}" text-anchor="middle" class="donut-total">${fmt(total)}</text>
      <text x="${cx}" y="${cy + 13}" text-anchor="middle" class="donut-cap">total</text>
    </svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

// ---- Win2K segmented progress bar (billing pool consumption) ----
export function progressBar(used, capacity, { overageColor = '#800000' } = {}) {
  const cap = capacity || 1;
  const pctUsed = Math.min(used, cap) / cap * 100;             // included portion
  const pctOver = Math.max(0, used - cap) / cap * 100;         // overage portion (of the pool)
  const total = Math.max(used, cap);
  const wIncluded = (Math.min(used, cap) / total) * 100;
  const wOver = (Math.max(0, used - cap) / total) * 100;
  return `<div class="w2k-progress" title="${fmt(used)} of ${fmt(cap)} included">
    <div class="pb-fill" style="width:${wIncluded.toFixed(1)}%"></div>
    <div class="pb-over" style="width:${wOver.toFixed(1)}%;background:
      repeating-linear-gradient(90deg, ${overageColor} 0 8px, #a03030 8px 10px)"></div>
  </div>
  <div class="pb-cap">${Math.round((used / cap) * 100)}% of included pool${pctOver > 0 ? ' · over' : ''}</div>`;
}

// ---- attach hover interactivity to charts inside root ----
export function mountCharts(root = document) {
  // line charts
  root.querySelectorAll('svg.chart[data-chart]').forEach(svg => {
    const geo = registry.get(svg.dataset.chart);
    if (!geo || svg._mounted) return;
    svg._mounted = true;
    const hit = svg.querySelector('.hit');
    const layer = svg.querySelector('.hover-layer');
    const cross = svg.querySelector('.crosshair');
    const dots = [...svg.querySelectorAll('.hdot')];
    const ctm = () => svg.getScreenCTM();

    hit.addEventListener('mousemove', ev => {
      const rect = svg.getBoundingClientRect();
      const scaleX = 720 / rect.width;
      const svgX = (ev.clientX - rect.left) * scaleX;
      const frac = (svgX - geo.x0) / (geo.x1 - geo.x0);
      const i = Math.max(0, Math.min(geo.n - 1, Math.round(frac * (geo.n - 1))));
      const px = geo.xOf(i);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      dots.forEach(d => {
        const s = geo.series[+d.dataset.si];
        d.setAttribute('cx', px); d.setAttribute('cy', geo.yOf(s.values[i]));
      });
      layer.style.display = '';
      const rows = geo.series.map((s, si) =>
        `<div class="tt-row"><span class="tt-key"><i style="background:${s.color || CATEGORICAL[si % CATEGORICAL.length]}"></i>${esc(s.name)}</span><b>${fmt(s.values[i])}</b></div>`).join('');
      showTip(`<div class="tt-title">${esc(geo.dates[i])}</div>${rows}`, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', () => { layer.style.display = 'none'; hideTip(); });
  });

  // bars + donut segments (delegated per element)
  root.querySelectorAll('[data-tip]').forEach(elm => {
    if (elm._mounted) return; elm._mounted = true;
    elm.addEventListener('mousemove', ev => showTip(esc(elm.getAttribute('data-tip')), ev.clientX, ev.clientY));
    elm.addEventListener('mouseleave', hideTip);
  });
}

export { fmt };
