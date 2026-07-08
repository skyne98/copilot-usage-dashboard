// Dependency-free SVG chart helpers. Theme-aware via CSS variables resolved at draw time.
// Each helper returns an SVG string. Colors come from the validated dataviz palette.

const SVGNS = 'http://www.w3.org/2000/svg';

// Categorical palette (dark-surface steps; readable on the glass cards).
export const CATEGORICAL = ['#3987e5', '#199e70', '#c98500', '#22a722', '#9085e9', '#e66767', '#d55181', '#d95926'];
export const ACCENT = '#5b8cff';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
};

// ---- Sparkline: tiny inline trend, no axes ----
export function sparkline(values, { width = 120, height = 32, color = ACCENT } = {}) {
  const v = values.length ? values : [0];
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const span = max - min || 1;
  const step = width / Math.max(v.length - 1, 1);
  const pts = v.map((val, i) => [i * step, height - ((val - min) / span) * (height - 4) - 2]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity="0.12"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"/>
  </svg>`;
}

// ---- Line chart: one or more series over dates ----
export function lineChart(dates, series, { height = 240, yFormat = fmt } = {}) {
  const W = 720, H = height, pad = { l: 44, r: 16, t: 16, b: 28 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const allVals = series.flatMap(s => s.values);
  const max = Math.max(...allVals, 1);
  const n = dates.length;
  const x = i => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = val => pad.t + ih - (val / max) * ih;

  const gridY = 4;
  let grid = '';
  for (let g = 0; g <= gridY; g++) {
    const gy = pad.t + (g / gridY) * ih;
    const val = max * (1 - g / gridY);
    grid += `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" class="grid"/>
      <text x="${pad.l - 8}" y="${(gy + 4).toFixed(1)}" class="axis" text-anchor="end">${yFormat(val)}</text>`;
  }

  // x labels (first, middle, last)
  let xlabels = '';
  [0, Math.floor((n - 1) / 2), n - 1].forEach(i => {
    if (i < 0 || i >= n) return;
    const d = (dates[i] || '').slice(5);
    xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="axis" text-anchor="middle">${d}</text>`;
  });

  const paths = series.map((s, si) => {
    const color = s.color || CATEGORICAL[si % CATEGORICAL.length];
    const d = s.values.map((val, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1)).join(' ');
    const area = s.area ? `<path d="${d} L ${x(n - 1)} ${pad.t + ih} L ${x(0)} ${pad.t + ih} Z" fill="${color}" opacity="0.10"/>` : '';
    return `${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  // invisible hover targets
  const dots = series.map((s, si) => {
    const color = s.color || CATEGORICAL[si % CATEGORICAL.length];
    return s.values.map((val, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(val).toFixed(1)}" r="3" fill="${color}" class="dot"><title>${esc(s.name)} · ${esc((dates[i] || '').slice(5))}: ${yFormat(val)}</title></circle>`
    ).join('');
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">
    ${grid}${xlabels}${paths}${dots}
  </svg>`;
}

// ---- Horizontal bar ranking ----
export function barList(items, { valueKey = 'value', labelKey = 'name', max: fixedMax, format = fmt, colorByIndex = false } = {}) {
  if (!items.length) return `<p class="muted">No data.</p>`;
  const max = fixedMax || Math.max(...items.map(i => i[valueKey]), 1);
  return `<div class="barlist">` + items.map((it, i) => {
    const pct = (it[valueKey] / max) * 100;
    const color = colorByIndex ? CATEGORICAL[i % CATEGORICAL.length] : ACCENT;
    const sub = it.sub != null ? `<span class="bar-sub">${esc(it.sub)}</span>` : '';
    return `<div class="bar-row">
      <div class="bar-label" title="${esc(it[labelKey])}">${esc(it[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <div class="bar-val">${format(it[valueKey])}${sub}</div>
    </div>`;
  }).join('') + `</div>`;
}

// ---- Donut: categorical shares ----
export function donut(items, { size = 200, thickness = 30, valueKey = 'value', labelKey = 'label' } = {}) {
  const total = items.reduce((a, b) => a + (b[valueKey] || 0), 0) || 1;
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let offset = 0;
  const rings = items.map((it, i) => {
    const frac = (it[valueKey] || 0) / total;
    const color = CATEGORICAL[i % CATEGORICAL.length];
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${thickness}"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset * C).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"><title>${esc(it[labelKey])}: ${Math.round(frac * 100)}%</title></circle>`;
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
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-total">${fmt(total)}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-cap">total</text>
    </svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

export { fmt };
