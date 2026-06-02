'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const COUNT_UP_DURATION_MS  = 800;
const ABBR_MILLION          = 1_000_000;
const ABBR_THOUSAND         = 1_000;
const DEFAULT_WOW_LIMIT     = 12;

// ─── Global state ─────────────────────────────────────────────────────────────
let config              = null;
let selectedMonth       = null;
let currentSummaryData  = null;
let currentTargetsData  = null;
let initialAnimDone     = false;

let analysisSubTab      = 'mom';
let filterState         = {};

let activePlatform      = 'google';
let googleDateRange     = { start: null, end: null };
let metaDateRange       = { start: null, end: null };
let currentGoogleData   = null;
let currentMetaData     = null;

let campaignSort     = { col: 'cost',  dir: 'desc' };
let metaCampaignSort = { col: 'spend', dir: 'desc' };

let wowShowAll = false;

let pendingModal = null;

// ─── Metric polarity — drives arrow colour and change-cell colour ─────────────
// higher_is_better: up = teal (good), down = amber (bad)
// lower_is_better:  down = teal (good), up = amber (bad)
const METRIC_POLARITY = {
  // Revenue / sales
  totalSales:        'higher_is_better',
  netSales:          'higher_is_better',
  orders:            'higher_is_better',
  aov:               'higher_is_better',
  roi:               'higher_is_better',
  // Website
  sessions:          'higher_is_better',
  visitors:          'higher_is_better',
  cvr:               'higher_is_better',
  // Google performance
  gConvValue:        'higher_is_better',
  gConversions:      'higher_is_better',
  gRoas:             'higher_is_better',
  gCost:             'lower_is_better',
  // Meta performance
  mPurchasesValue:   'higher_is_better',
  mPurchases:        'higher_is_better',
  mRoas:             'higher_is_better',
  mSpend:            'lower_is_better',
  costPerPurchase:   'lower_is_better',
  // Combined / impressions / clicks
  totalImpressions:  'higher_is_better',
  totalClicks:       'higher_is_better',
  ctrCombined:       'higher_is_better',
  cpcCombined:       'lower_is_better',
  cpmCombined:       'lower_is_better',
  ctrGoogle:         'higher_is_better',
  cpcGoogle:         'lower_is_better',
  cpmGoogle:         'lower_is_better',
  ctrMeta:           'higher_is_better',
  cpcMeta:           'lower_is_better',
  cpmMeta:           'lower_is_better',
  totalSpend:        'lower_is_better',
  // Tab 3 card keys (Google)
  cost:              'lower_is_better',
  impressions:       'higher_is_better',
  clicks:            'higher_is_better',
  conversions:       'higher_is_better',
  convValue:         'higher_is_better',
  roas:              'higher_is_better',
  ctr:               'higher_is_better',
  cpc:               'lower_is_better',
  cpm:               'lower_is_better',
  // Tab 3 card keys (Meta)
  spend:             'lower_is_better',
  reach:             'higher_is_better',
  purchases:         'higher_is_better',
  purchasesValue:    'higher_is_better',
};

// ─── Analysis metric definitions ─────────────────────────────────────────────
const ANALYSIS_METRICS = [
  // ── Advertising
  { key: 'totalImpressions', label: 'Impressions',   type: 'integer_abbr', group: 'Advertising', defaultChecked: true  },
  { key: 'totalClicks',      label: 'Clicks',        type: 'integer_abbr', group: 'Advertising', defaultChecked: true  },
  { key: 'ctrCombined',      label: 'CTR',           type: 'percent',      group: 'Advertising', defaultChecked: true  },
  { key: 'totalSpend',       label: 'Ad Spend',      type: 'currency',     group: 'Advertising', defaultChecked: true  },
  { key: 'cpcCombined',      label: 'CPC',           type: 'currency',     group: 'Advertising', defaultChecked: true  },
  { key: 'cpmCombined',      label: 'CPM',           type: 'currency',     group: 'Advertising', defaultChecked: true  },
  // ── Website
  { key: 'visitors',         label: 'Website Visits',type: 'integer_abbr', group: 'Website',     defaultChecked: true  },
  { key: 'sessions',         label: 'Sessions',      type: 'integer_abbr', group: 'Website',     defaultChecked: false },
  { key: 'orders',           label: 'Orders',        type: 'integer',      group: 'Website',     defaultChecked: true  },
  { key: 'cvr',              label: 'CVR',           type: 'percent',      group: 'Website',     defaultChecked: true  },
  // ── Revenue
  { key: 'totalSales',       label: 'Website Sales', type: 'currency',     group: 'Revenue',     defaultChecked: true  },
  { key: 'netSales',         label: 'Net Sales',     type: 'currency',     group: 'Revenue',     defaultChecked: true  },
  { key: 'aov',              label: 'AOV',           type: 'currency',     group: 'Revenue',     defaultChecked: true  },
  { key: 'roi',              label: 'ROI',           type: 'multiplier',   group: 'Revenue',     defaultChecked: true  },
];

// ─── Number formatting ────────────────────────────────────────────────────────
function formatNumber(value, type) {
  if (value === null || value === undefined) {
    return '<span class="na">N/A</span>';
  }
  if (typeof value === 'number' && (!isFinite(value) || isNaN(value))) {
    return '<span class="na">N/A</span>';
  }

  switch (type) {
    case 'currency':
      return '$' + value.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    case 'currency_abbr':
      if (value >= ABBR_MILLION)  return '$' + (value / ABBR_MILLION).toFixed(1) + 'M';
      if (value >= ABBR_THOUSAND) return '$' + (value / ABBR_THOUSAND).toFixed(1) + 'K';
      return '$' + value.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    case 'integer':
      return Math.round(value).toLocaleString('en-AU');

    case 'integer_abbr':
      if (value >= ABBR_MILLION)  return (value / ABBR_MILLION).toFixed(1) + 'M';
      if (value >= ABBR_THOUSAND) return (value / ABBR_THOUSAND).toFixed(1) + 'K';
      return Math.round(value).toLocaleString('en-AU');

    case 'multiplier':
      return value.toFixed(2) + 'x';

    case 'percent':
      return (value * 100).toFixed(2) + '%';

    default:
      return String(value);
  }
}

function formatNumberPlain(value, type) {
  if (value === null || value === undefined || (typeof value === 'number' && (!isFinite(value) || isNaN(value)))) {
    return 'N/A';
  }
  return formatNumber(value, type).replace(/<[^>]+>/g, '');
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function fmtDateDMY(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateDM(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function fmtMonthLong(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const names = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  return `${names[month - 1]} ${year}`;
}

function fmtMonthShort(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[month - 1]} ${year}`;
}

function fmtDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmtWeekRange(start, end) {
  const s  = new Date(start + 'T00:00:00Z');
  const e  = new Date(end   + 'T00:00:00Z');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sStr = `${String(s.getUTCDate()).padStart(2,'0')} ${mo[s.getUTCMonth()]}`;
  const eStr = `${String(e.getUTCDate()).padStart(2,'0')} ${mo[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  return `${sStr}–${eStr}`;
}

// ─── Initialisation ───────────────────────────────────────────────────────────
async function init() {
  try {
    config = await fetch('/api/config').then(r => r.json());
  } catch (e) {
    console.error('Failed to load config:', e);
    return;
  }

  setupWarnings();
  setupFooter();
  setupGooeyNav();
  setupModal();
  setupTicker();

  const brandEl = document.querySelector('.header-brand');
  if (brandEl) {
    brandEl.addEventListener('click', () => {
      document.querySelector('.tab-btn[data-tab="daywise"]')?.click();
    });
  }
  setupFilterPanel();
  setupAnalysisSubTabs();
  setupTab3();
  initSpotlight();

  const todayYM = new Date().toISOString().slice(0, 7);
  selectedMonth = (config.availableMonths || []).includes(todayYM)
    ? todayYM
    : (config.availableMonths?.[0] || null);

  await loadTab1();
}

// ─── Warning banners ──────────────────────────────────────────────────────────
function setupWarnings() {
  const container = document.getElementById('warnings-container');
  if (!container) return;
  (config.warnings || []).forEach(msg => {
    const div = document.createElement('div');
    div.className = 'warning-banner';
    div.textContent = `⚠ Warning: ${msg}`;
    container.appendChild(div);
  });
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function setupFooter() {
  const el = document.getElementById('footer-cutoff');
  if (el && config.dataCutoff) {
    el.textContent = `Data current to: ${fmtDateDMY(config.dataCutoff)}`;
  }
}

// ─── Gooey Tab Navigation (Change 2) ─────────────────────────────────────────
function setupGooeyNav() {
  const nav = document.querySelector('.tab-nav');
  if (!nav) return;

  // Inject gooey filter layer + pill
  const filterLayer = document.createElement('div');
  filterLayer.className = 'gooey-filter-layer';
  const pill = document.createElement('div');
  pill.className = 'gooey-pill';
  pill.id = 'gooey-pill';
  filterLayer.appendChild(pill);
  nav.insertBefore(filterLayer, nav.firstChild);

  // Inject particles container
  const particles = document.createElement('div');
  particles.className = 'gooey-particles';
  particles.id = 'gooey-particles';
  nav.appendChild(particles);

  // Position pill to exactly match the target button
  function positionPill(btn, animate) {
    const containerRect = filterLayer.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const left    = btnRect.left   - containerRect.left;
    const top     = btnRect.top    - containerRect.top;
    const w       = btnRect.width;
    const h       = btnRect.height;
    if (animate && typeof gsap !== 'undefined') {
      gsap.to(pill, {
        left, top, width: w, height: h,
        duration: 0.35, ease: 'expo.out',
        force3D: true, overwrite: 'auto',
      });
    } else {
      // Instant — use gsap.set to avoid any transform conflicts
      if (typeof gsap !== 'undefined') {
        gsap.set(pill, { left, top, width: w, height: h });
      } else {
        pill.style.left   = left + 'px';
        pill.style.top    = top  + 'px';
        pill.style.width  = w    + 'px';
        pill.style.height = h    + 'px';
      }
    }
  }

  // Burst particles from the pill's current visual centre
  function burstParticles(btn) {
    const navRect = nav.getBoundingClientRect();
    // Use the pill's current rendered position as the burst origin
    const pillRect = pill.getBoundingClientRect();
    const cx = (pillRect.left + pillRect.width  / 2) - navRect.left;
    const cy = (pillRect.top  + pillRect.height / 2) - navRect.top;
    const colors = [
      'rgba(0,212,170,1)', 'rgba(0,180,145,1)',
      'rgba(0,150,120,1)', 'rgba(0,212,170,0.6)',
    ];
    for (let i = 0; i < 15; i++) {
      const p = document.createElement('div');
      const size = 5 + Math.random() * 5;
      p.style.cssText = `
        position:absolute;
        width:${size}px;height:${size}px;
        border-radius:50%;
        background:${colors[i % colors.length]};
        left:${cx}px;top:${cy}px;
        pointer-events:none;
        transform:translate(-50%,-50%);
      `;
      particles.appendChild(p);
      const angle = (Math.PI * 2 * i) / 15 + Math.random() * 0.3;
      const dist  = 18 + Math.random() * 28;
      if (typeof gsap !== 'undefined') {
        gsap.to(p, {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          opacity: 0,
          duration: 0.5 + Math.random() * 0.3,
          ease: 'power2.out',
          onComplete: () => p.remove(),
        });
      } else {
        setTimeout(() => p.remove(), 600);
      }
    }
  }

  // Wire up tab buttons
  const btns = nav.querySelectorAll('.tab-btn');

  // Initial pill position — double rAF ensures fonts + layout are settled
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const active = nav.querySelector('.tab-btn.active');
    if (active) positionPill(active, false);
  }));

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      btns.forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', b.dataset.tab === tab);
      });
      document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('hidden', p.id !== `tab-${tab}`);
      });
      positionPill(btn, true);
      burstParticles(btn);

      if (tab === 'daywise' && selectedMonth && currentSummaryData) {
        destroyAllSparklines();
        renderTargetCards(currentSummaryData, currentTargetsData);
        renderPrimaryCards(currentSummaryData);
        renderSecondaryCards(currentSummaryData);
      }
      if (tab === 'analysis') {
        loadAnalysis();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (typeof window.initSubtabPill === 'function') window.initSubtabPill();
        }));
      }
      if (tab === 'ads')      loadTab3();
    });
  });

  // Reposition pill on window resize
  window.addEventListener('resize', () => {
    const active = nav.querySelector('.tab-btn.active');
    if (active) positionPill(active, false);
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function setupModal() {
  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close');
  closeBtn?.addEventListener('click', closeModal);
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function openModal(title, labels, values, formatType) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-overlay').classList.remove('hidden');
  createModalChart(labels, values, formatType, formatNumberPlain);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  destroyModalChart();
}

// ─── TAB 1: DAY-WISE ─────────────────────────────────────────────────────────
async function loadTab1() {
  setupMonthSelector();
  if (!selectedMonth) return;
  await renderTab1(selectedMonth);
}

function setupMonthSelector() {
  const sel = document.getElementById('month-selector');
  if (!sel) return;
  sel.innerHTML = '';
  (config.availableMonths || []).forEach(ym => {
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = fmtMonthLong(ym);
    if (ym === selectedMonth) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', async () => {
    selectedMonth = sel.value;
    await renderTab1(selectedMonth);
  });
}

async function renderTab1(month) {
  const [summaryRes, dailyRes, targetsRes] = await Promise.all([
    fetch(`/api/summary?month=${month}`).then(r => r.json()),
    fetch(`/api/daily?month=${month}`).then(r => r.json()),
    fetch(`/api/targets?month=${month}`).then(r => r.json()).catch(() => null),
  ]);
  currentSummaryData = summaryRes;
  currentTargetsData = targetsRes;
  destroyAllSparklines();
  renderTargetCards(summaryRes, targetsRes);
  renderPrimaryCards(summaryRes);
  renderSecondaryCards(summaryRes);
  renderDayTable(dailyRes, month, summaryRes);
  updateTicker(summaryRes, month);
}

// ─── Count-up animation ───────────────────────────────────────────────────────
function countUp(element, targetValue, type) {
  if (!element) return;
  if (targetValue === null || targetValue === undefined) {
    element.innerHTML = formatNumber(null, type);
    return;
  }
  if (initialAnimDone) {
    element.innerHTML = formatNumber(targetValue, type);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / COUNT_UP_DURATION_MS, 1);
    const eased    = 1 - Math.pow(1 - progress, 2);
    element.innerHTML = formatNumber(targetValue * eased, type);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.innerHTML = formatNumber(targetValue, type);
      // Glow pulse on completion
      element.classList.add('value-pulse');
      setTimeout(() => element.classList.remove('value-pulse'), 600);
    }
  }
  requestAnimationFrame(tick);
}

// ─── No-decimal formatter for target card values ──────────────────────────────
function fmtTarget(val, type) {
  if (val === null || val === undefined) return '<span class="na">N/A</span>';
  switch (type) {
    case 'currency':   return '$' + Math.round(val).toLocaleString('en-AU');
    case 'multiplier': return parseFloat(val.toFixed(1)) + 'x';
    default:           return formatNumber(val, type);
  }
}

// ─── Target card rendering ────────────────────────────────────────────────────
function renderTargetCards(summary, targets) {
  const container = document.getElementById('target-cards');
  if (!container) return;

  if (!targets) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const { current, daysWithData, daysInMonth } = summary;

  const defs = [
    { id: 'tc-sales', title: 'Target Sales', target: targets.targetSales, actual: current.totalSales,  type: 'currency',   polarity: 'higher_is_better', noProjection: false },
    { id: 'tc-roi',   title: 'Target ROI',   target: targets.targetRoi,   actual: current.roi,         type: 'multiplier', polarity: 'higher_is_better', noProjection: true  },
    { id: 'tc-spend', title: 'Target Spend', target: targets.targetSpend, actual: current.totalSpend,  type: 'currency',   polarity: null,               noProjection: false },
  ];

  container.classList.remove('hidden');
  container.innerHTML = '';

  defs.forEach(def => {
    if (!def.target || def.target <= 0) return;

    const actualVal  = def.actual || 0;
    const percent    = def.target > 0 ? actualVal / def.target : 0;
    const pct        = Math.min(Math.round(percent * 100), 999);
    const overTarget = actualVal > def.target;

    // Projected full-month value (not applicable to ROI)
    const projected = (!def.noProjection && daysWithData > 0)
      ? (actualVal / daysWithData) * daysInMonth
      : null;

    // Pace: ROI uses actual vs target directly; others use projected vs target
    let paceLabel = '';
    let paceColor = 'var(--text-secondary)';
    if (def.target > 0) {
      const compareVal = def.noProjection ? actualVal : projected;
      if (compareVal !== null) {
        if (overTarget) {
          paceLabel = 'Target Hit';
          paceColor = 'var(--accent-positive)';
        } else {
          const ratio = compareVal / def.target; // 1.0 = exactly on target
          if (ratio >= 0.99 && ratio <= 1.01) {
            paceLabel = 'On Track';
            paceColor = 'var(--text-secondary)';
          } else if (ratio > 1.01) {
            paceLabel = 'Ahead';
            paceColor = 'var(--accent-positive)';
          } else {
            paceLabel = 'Behind';
            paceColor = 'var(--accent-negative)';
          }
        }
      }
    }

    let statusClass = '';
    if (def.polarity === 'higher_is_better' && overTarget) statusClass = 'glow-positive';

    const card = document.createElement('div');
    card.className = `card card-primary target-card ${statusClass}`;
    card.id = def.id;

    card.innerHTML = `
      <div class="target-card-left">
        <div class="card-title">${def.title}</div>
        <div class="card-value-row">
          <span class="card-main-value num">${fmtTarget(def.target, def.type)}</span>
        </div>
        <div class="card-sub-lines">
          <div class="card-sub-line">Actual: <span class="sub-val">${fmtTarget(actualVal, def.type)}</span></div>
          ${projected !== null ? `<div class="card-sub-line">Projected: <span class="sub-val">${fmtTarget(projected, def.type)}</span></div>` : ''}
          ${paceLabel ? `<div class="card-sub-line">Pace: <span class="sub-val" style="color:${paceColor}">${paceLabel}</span></div>` : ''}
        </div>
      </div>
      <div class="target-donut-wrap">
        <canvas id="donut-${def.id}"></canvas>
        <div class="target-pct-label">${overTarget ? '✓' : pct + '%'}</div>
      </div>
    `;

    container.appendChild(card);
    createDonutChart(`donut-${def.id}`, percent, overTarget, def.polarity);
  });

  if (container.children.length === 0) {
    container.classList.add('hidden');
    return;
  }

  initCardEffects();
}

// ─── Primary card rendering ───────────────────────────────────────────────────
function renderPrimaryCards(summary) {
  const container = document.getElementById('primary-cards');
  if (!container) return;

  const { current, prev, daysInMonth, daysWithData, sparklines, sparklineDates } = summary;

  const cards = [
    {
      id: 'card-totalSales', key: 'totalSales', title: 'Total Sales',
      type: 'currency', sparkKey: 'totalSales',
      sub: (c) => [
        { label: 'Avg/day', val: daysWithData > 0 ? c.totalSales / daysWithData : null, type: 'currency' },
        { label: 'Projected', val: daysWithData > 0 ? (c.totalSales / daysWithData) * daysInMonth : null, type: 'currency' },
      ],
    },
    {
      id: 'card-orders', key: 'orders', title: 'Total Orders',
      type: 'integer', sparkKey: 'orders',
      sub: (c) => [
        { label: 'Avg/day', val: daysWithData > 0 ? c.orders / daysWithData : null, type: 'integer' },
        { label: 'Projected', val: daysWithData > 0 ? Math.round((c.orders / daysWithData) * daysInMonth) : null, type: 'integer' },
      ],
    },
    {
      id: 'card-totalSpend', key: 'totalSpend', title: 'Total Ad Spend',
      type: 'currency', sparkKey: 'totalSpend',
      sub: (c) => [
        { label: 'Avg/day', val: daysWithData > 0 ? c.totalSpend / daysWithData : null, type: 'currency' },
        { label: 'Projected', val: daysWithData > 0 ? (c.totalSpend / daysWithData) * daysInMonth : null, type: 'currency' },
      ],
    },
    {
      id: 'card-roi', key: 'roi', title: 'ROI',
      type: 'multiplier', sparkKey: 'roi',
      sub: () => [],
    },
  ];

  container.innerHTML = '';
  cards.forEach(def => {
    const mainVal  = current[def.key];
    const prevVal  = prev[def.key];
    const trending = getTrend(mainVal, prevVal, def.key);
    const subLines = def.sub(current);

    const card = document.createElement('div');
    card.className = `card card-primary ${trending.glowClass}`;
    card.id = def.id;

    card.innerHTML = `
      <div class="card-title">${def.title}</div>
      <div class="card-value-row">
        <span class="card-main-value num" id="${def.id}-val" data-rawval="${mainVal}" data-type="${def.type}">0</span>
        ${trending.arrow}
      </div>
      <div class="card-sub-lines">
        ${subLines.map(s => `<div class="card-sub-line">${s.label}: <span class="sub-val">${formatNumber(s.val, s.type)}</span></div>`).join('')}
      </div>
      <div class="sparkline-wrap">
        <canvas class="sparkline-canvas" id="sparkline-${def.id}"></canvas>
      </div>
    `;
    container.appendChild(card);

    const valEl = card.querySelector(`#${def.id}-val`);
    countUp(valEl, mainVal, def.type);
    createSparkline(`sparkline-${def.id}`, sparklines[def.sparkKey], 36);

    card.addEventListener('click', () => {
      const labels = sparklineDates.map(fmtDateDM);
      const values = sparklines[def.sparkKey];
      openModal(`${def.title} — ${fmtMonthLong(selectedMonth)}`, labels, values, def.type);
    });
  });

  initialAnimDone = true;
  initCardEffects();
}

// ─── Secondary card rendering ─────────────────────────────────────────────────
function renderSecondaryCards(summary) {
  const container = document.getElementById('secondary-cards');
  if (!container) return;

  const { current, prev, daysInMonth, daysWithData, sparklines, sparklineDates } = summary;

  const cards = [
    { id: 'sc-netSales',         key: 'netSales',         title: 'Net Sales',         type: 'currency',     sparkKey: 'netSales'        },
    { id: 'sc-aov',              key: 'aov',              title: 'AOV',               type: 'currency',     sparkKey: 'aov',             noSubLines: true },
    { id: 'sc-gRoas',            key: 'gRoas',            title: 'Google ROAS',       type: 'multiplier',   sparkKey: 'gRoas',           noSubLines: true },
    { id: 'sc-mRoas',            key: 'mRoas',            title: 'Meta ROAS',         type: 'multiplier',   sparkKey: 'mRoas',           noSubLines: true },
    { id: 'sc-totalImpressions', key: 'totalImpressions', title: 'Total Impressions', type: 'integer_abbr', sparkKey: 'totalImpressions'},
    { id: 'sc-totalClicks',      key: 'totalClicks',      title: 'Total Clicks',      type: 'integer_abbr', sparkKey: 'totalClicks'     },
    { id: 'sc-visitors',         key: 'visitors',         title: 'Website Visits',    type: 'integer_abbr', sparkKey: 'visitors'        },
    { id: 'sc-metaSales',        key: 'mPurchasesValue',  title: 'Meta Sales',        type: 'currency',     sparkKey: 'metaSales'       },
    { id: 'sc-googleSales',      key: 'gConvValue',       title: 'Google Sales',      type: 'currency',     sparkKey: 'googleSales'     },
  ];

  container.innerHTML = '';
  cards.forEach(def => {
    const mainVal  = current[def.key];
    const prevVal  = prev[def.key];
    const trending = getTrend(mainVal, prevVal, def.key);

    const card = document.createElement('div');
    card.className = `card card-secondary ${trending.glowClass}`;
    card.id = def.id;

    const avgPerDay = daysWithData > 0 ? mainVal / daysWithData : null;
    const projected = daysWithData > 0 ? (mainVal / daysWithData) * daysInMonth : null;

    const subLinesHtml = def.noSubLines ? '' : `
      <div class="card-sub-lines">
        <div class="card-sub-line">Avg/day: <span class="sub-val">${formatNumber(avgPerDay, def.type)}</span></div>
        <div class="card-sub-line">Projected: <span class="sub-val">${formatNumber(projected, def.type)}</span></div>
      </div>`;

    card.innerHTML = `
      <div class="card-title">${def.title}</div>
      <div class="card-value-row">
        <span class="card-main-value num" id="${def.id}-val">${formatNumber(mainVal, def.type)}</span>
        ${trending.arrow}
      </div>
      ${subLinesHtml}
      <div class="sparkline-wrap">
        <canvas class="sparkline-canvas" id="sparkline-${def.id}"></canvas>
      </div>
    `;
    container.appendChild(card);

    createSparkline(`sparkline-${def.id}`, sparklines[def.sparkKey], 24);

    card.addEventListener('click', () => {
      const labels = sparklineDates.map(fmtDateDM);
      const values = sparklines[def.sparkKey];
      openModal(`${def.title} — ${fmtMonthLong(selectedMonth)}`, labels, values, def.type);
    });
  });

  initCardEffects();
}

// ─── Trend arrow (polarity-aware) ────────────────────────────────────────────
function getTrend(current, prev, metricKey) {
  if (current === null || prev === null || prev === undefined || current === undefined) {
    return { glowClass: '', arrow: '' };
  }
  const polarity = METRIC_POLARITY[metricKey] || 'higher_is_better';
  const up = current > prev;
  const dn = current < prev;
  if (!up && !dn) return { glowClass: '', arrow: '' };

  const isGood = polarity === 'higher_is_better' ? up : dn;
  if (isGood) {
    return { glowClass: 'glow-positive', arrow: '<span class="trend-up">↑</span>' };
  } else {
    return { glowClass: 'glow-negative', arrow: '<span class="trend-down">↓</span>' };
  }
}

// ─── Day-by-day table ─────────────────────────────────────────────────────────
function renderDayTable(rows, month, summary) {
  renderDayTableHead();
  renderDayTableBody(rows);
  renderDayTableFoot(rows, summary);
}

function renderDayTableHead() {
  const thead = document.getElementById('day-table-head');
  if (!thead) return;

  const groupRow = document.createElement('tr');
  groupRow.className = 'group-row';
  groupRow.innerHTML = `
    <th rowspan="2" class="col-date">Date</th>
    <th colspan="6" class="group-website">Website</th>
    <th colspan="7" class="group-google">Google Ads</th>
    <th colspan="7" class="group-meta">Meta Ads</th>
    <th colspan="5" class="group-combined">Combined</th>
  `;

  const colRow = document.createElement('tr');
  colRow.className = 'subhead-row';
  const cols = [
    'Website Sales','Net Sales','Orders','AOV','Sessions','Website Visits',
    'G. Spend','G. Impressions','G. Clicks','G. CTR','G. Conversions','G. Sales','G. ROAS',
    'M. Spend','M. Impressions','M. Clicks','M. CTR','M. Purchases','M. Sales','M. ROAS',
    'Total Spend','Total Impressions','Total Clicks','Total CTR','ROI',
  ];
  colRow.innerHTML = cols.map(c => `<th>${c}</th>`).join('');

  thead.innerHTML = '';
  thead.appendChild(groupRow);
  thead.appendChild(colRow);
}

function renderDayTableBody(rows) {
  const tbody = document.getElementById('day-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const dateCell = `<td>${fmtDateDMY(row.date)}</td>`;

    if (!row.hasData) {
      const empties = Array(25).fill('<td><span class="empty">—</span></td>').join('');
      tr.innerHTML = dateCell + empties;
    } else {
      tr.innerHTML = dateCell + [
        fmtCell(row.totalSales,       'currency'),
        fmtCell(row.netSales,         'currency'),
        fmtCell(row.orders,           'integer'),
        fmtCell(row.aov,              'currency'),
        fmtCell(row.sessions,         'integer'),
        fmtCell(row.visitors,         'integer'),
        fmtCell(row.gCost,            'currency'),
        fmtCell(row.gImpressions,     'integer'),
        fmtCell(row.gClicks,          'integer'),
        fmtCell(row.gCtr,             'percent'),
        fmtCell(row.gConversions,     'integer'),
        fmtCell(row.gSales,           'currency'),
        fmtCell(row.gRoas,            'multiplier'),
        fmtCell(row.mSpend,           'currency'),
        fmtCell(row.mImpressions,     'integer'),
        fmtCell(row.mClicks,          'integer'),
        fmtCell(row.mCtr,             'percent'),
        fmtCell(row.mPurchases,       'integer'),
        fmtCell(row.mSales,           'currency'),
        fmtCell(row.mRoas,            'multiplier'),
        fmtCell(row.totalSpend,       'currency'),
        fmtCell(row.totalImpressions, 'integer'),
        fmtCell(row.totalClicks,      'integer'),
        fmtCell(row.totalCtr,         'percent'),
        fmtCell(row.roi,              'multiplier'),
      ].join('');
    }
    tbody.appendChild(tr);
  });
}

function fmtCell(val, type) {
  if (val === null || val === undefined) return '<td><span class="empty">—</span></td>';
  return `<td>${formatNumber(val, type)}</td>`;
}

function renderDayTableFoot(rows, summary) {
  const tfoot = document.getElementById('day-table-foot');
  if (!tfoot) return;

  const c = summary.current;

  const totalCtr  = c.totalImpressions > 0 ? c.totalClicks / c.totalImpressions : null;
  const gCtr      = c.gImpressions > 0     ? c.gClicks / c.gImpressions         : null;
  const mCtr      = c.mImpressions > 0     ? c.mClicks / c.mImpressions         : null;
  const aov       = c.orders > 0           ? c.totalSales / c.orders            : null;
  const gRoas     = c.gCost > 0            ? c.gConvValue / c.gCost             : null;
  const mRoas     = c.mSpend > 0           ? c.mPurchasesValue / c.mSpend       : null;
  const roi       = c.totalSpend > 0       ? c.totalSales / c.totalSpend        : null;

  const tr = document.createElement('tr');
  tr.innerHTML = `<td>MONTH TOTAL</td>` + [
    fmtCell(c.totalSales,       'currency'),
    fmtCell(c.netSales,         'currency'),
    fmtCell(c.orders,           'integer'),
    fmtCell(aov,                'currency'),
    fmtCell(c.sessions,         'integer'),
    fmtCell(c.visitors,         'integer'),
    fmtCell(c.gCost,            'currency'),
    fmtCell(c.gImpressions,     'integer'),
    fmtCell(c.gClicks,          'integer'),
    fmtCell(gCtr,               'percent'),
    fmtCell(c.gConversions,     'integer'),
    fmtCell(c.gConvValue,       'currency'),
    fmtCell(gRoas,              'multiplier'),
    fmtCell(c.mSpend,           'currency'),
    fmtCell(c.mImpressions,     'integer'),
    fmtCell(c.mClicks,          'integer'),
    fmtCell(mCtr,               'percent'),
    fmtCell(c.mPurchases,       'integer'),
    fmtCell(c.mPurchasesValue,  'currency'),
    fmtCell(mRoas,              'multiplier'),
    fmtCell(c.totalSpend,       'currency'),
    fmtCell(c.totalImpressions, 'integer'),
    fmtCell(c.totalClicks,      'integer'),
    fmtCell(totalCtr,           'percent'),
    fmtCell(roi,                'multiplier'),
  ].join('');

  tfoot.innerHTML = '';
  tfoot.appendChild(tr);
}

// ─── TAB 2: ANALYSIS ─────────────────────────────────────────────────────────
function setupFilterPanel() {
  ANALYSIS_METRICS.forEach(m => { filterState[m.key] = m.defaultChecked; });

  const container = document.getElementById('filter-checkboxes');
  if (!container) return;

  const groups = {};
  ANALYSIS_METRICS.forEach(m => {
    if (!groups[m.group]) groups[m.group] = [];
    groups[m.group].push(m);
  });

  let html = '';
  for (const [groupName, metrics] of Object.entries(groups)) {
    html += `<div class="filter-group-label">${groupName}</div>`;
    metrics.forEach(m => {
      html += `
        <div class="filter-item">
          <input type="checkbox" id="filter-${m.key}" data-key="${m.key}" ${m.defaultChecked ? 'checked' : ''}>
          <label for="filter-${m.key}">${m.label}</label>
        </div>`;
    });
  }
  container.innerHTML = html;

  container.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (key) {
      filterState[key] = e.target.checked;
      renderAnalysisContent();
    }
  });

  document.getElementById('filter-toggle')?.addEventListener('click', () => {
    document.getElementById('filter-panel')?.classList.toggle('open');
  });
  document.getElementById('filter-close')?.addEventListener('click', () => {
    document.getElementById('filter-panel')?.classList.remove('open');
  });
}

function setupAnalysisSubTabs() {
  const nav = document.querySelector('.subtab-nav');

  // Inject sliding pill
  let subtabPill = null;
  if (nav) {
    subtabPill = document.createElement('div');
    subtabPill.className = 'subtab-pill';
    nav.insertBefore(subtabPill, nav.firstChild);
  }

  let subtabPillReady = false;

  function positionSubtabPill(btn, retryCount = 0) {
    if (!subtabPill || !nav || !btn) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const left    = btnRect.left - navRect.left;
    const top     = btnRect.top  - navRect.top;
    const w       = btnRect.width;
    const h       = btnRect.height;

    // If dimensions are zero the tab panel isn't laid out yet — retry up to 5 frames
    if ((w === 0 || h === 0) && retryCount < 5) {
      requestAnimationFrame(() => positionSubtabPill(btn, retryCount + 1));
      return;
    }

    if (!subtabPillReady || typeof gsap === 'undefined') {
      // First call: snap into position
      if (typeof gsap !== 'undefined') {
        gsap.set(subtabPill, { left, top, width: w, height: h });
      } else {
        subtabPill.style.left   = left + 'px';
        subtabPill.style.top    = top  + 'px';
        subtabPill.style.width  = w    + 'px';
        subtabPill.style.height = h    + 'px';
      }
      subtabPillReady = true;
    } else {
      gsap.to(subtabPill, { left, top, width: w, height: h, duration: 0.35, ease: 'expo.out', force3D: true, overwrite: 'auto' });
    }
  }

  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      analysisSubTab = btn.dataset.subtab;
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.subtab === analysisSubTab));
      positionSubtabPill(btn);
      renderAnalysisContent();
    });
  });

  // Exposed for gooey nav to call once Tab 2 is visible in the DOM
  window.initSubtabPill = function() {
    if (subtabPillReady) return;
    const active = document.querySelector('.subtab-btn.active');
    if (active) positionSubtabPill(active);
  };

  window.addEventListener('resize', () => {
    const active = document.querySelector('.subtab-btn.active');
    if (active) positionSubtabPill(active);
  });
}

async function loadAnalysis() {
  await renderAnalysisContent();
}

async function renderAnalysisContent() {
  const container = document.getElementById('analysis-content');
  if (!container) return;

  switch (analysisSubTab) {
    case 'mom':    await renderMoM(container);    break;
    case 'wow':    await renderWoW(container);    break;
    case 'mtd':    await renderMTD(container);    break;
    case 'custom': renderCustomRange(container);  break;
  }
}

// ── Shared comparison table builder ──────────────────────────────────────────
function selectedMetrics() {
  return ANALYSIS_METRICS.filter(m => filterState[m.key]);
}

function buildVerticalTable(heading, currentColLabel, prevColLabel, current, prev) {
  const metrics = selectedMetrics();
  if (!metrics.length) return '';

  const rows = metrics.map(m => {
    const curr = current[m.key];
    const prv  = prev[m.key];
    const { absChange, pctChange, cls } = computeChange(curr, prv, m.type, m.key);
    return `
      <tr>
        <td class="v-metric-cell">${m.label}</td>
        <td>${formatNumber(curr, m.type)}</td>
        <td>${formatNumber(prv,  m.type)}</td>
        <td class="${cls}">${absChange}</td>
        <td class="${cls}">${pctChange}</td>
      </tr>`;
  }).join('');

  return `
    <div class="period-block">
      <div class="period-heading">${heading}</div>
      <table class="analysis-table v-table">
        <thead>
          <tr>
            <th class="v-metric-col">Metric</th>
            <th>${currentColLabel}</th>
            <th>${prevColLabel}</th>
            <th>Change</th>
            <th>% Change</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildCustomSummaryTable(heading, subheading, metrics, data) {
  if (!metrics.length) return '';
  const rows = metrics.map(m => `
    <tr>
      <td class="v-metric-cell">${m.label}</td>
      <td>${formatNumber(data[m.key], m.type)}</td>
    </tr>`).join('');

  return `
    <div class="period-block">
      <div class="period-heading">${heading}</div>
      ${subheading ? `<div class="period-subheading">${subheading}</div>` : ''}
      <table class="analysis-table v-table">
        <thead><tr><th class="v-metric-col">Metric</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Polarity-aware change computation
function computeChange(curr, prev, type, metricKey) {
  if (curr === null || prev === null || curr === undefined || prev === undefined) {
    return { absChange: '<span class="na">N/A</span>', pctChange: '<span class="na">N/A</span>', cls: '' };
  }

  const abs  = curr - prev;
  const pct  = prev !== 0 ? abs / Math.abs(prev) : null;
  const up   = abs > 0;
  const dn   = abs < 0;
  const arrow = up ? '↑' : dn ? '↓' : '→';
  const sign  = abs >= 0 ? '+' : '−';
  const mag   = Math.abs(abs);

  const polarity = METRIC_POLARITY[metricKey] || 'higher_is_better';
  let cls;
  if (abs === 0) {
    cls = 'change-zero';
  } else if (polarity === 'higher_is_better') {
    cls = up ? 'change-pos' : 'change-neg';
  } else {
    cls = dn ? 'change-pos' : 'change-neg'; // lower is better: decrease = good
  }

  let absStr;
  if (type === 'currency') {
    absStr = sign + formatNumber(mag, 'currency');
  } else if (type === 'multiplier') {
    absStr = sign + mag.toFixed(2) + 'x';
  } else if (type === 'percent') {
    absStr = sign + (mag * 100).toFixed(2) + 'pp';
  } else if (type === 'integer' || type === 'integer_abbr') {
    absStr = sign + formatNumber(mag, 'integer');
  } else {
    absStr = sign + formatNumber(mag, type);
  }

  const pctStr = pct !== null
    ? `${arrow} ${Math.abs(pct * 100).toFixed(1)}%`
    : '<span class="na">N/A</span>';

  return { absChange: `${arrow} ${absStr}`, pctChange: pctStr, cls };
}

// ── Month on Month ────────────────────────────────────────────────────────────
async function renderMoM(container) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">Loading…</p>';
  const data = await fetch('/api/analysis/mom').then(r => r.json());

  if (!data.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">Not enough data for month comparisons.</p>';
    return;
  }

  container.innerHTML = data.map(pair => buildVerticalTable(
    `${fmtMonthLong(pair.currentMonth)} vs ${fmtMonthLong(pair.prevMonth)}`,
    fmtMonthShort(pair.currentMonth),
    fmtMonthShort(pair.prevMonth),
    pair.current,
    pair.prev,
  )).join('');
}

// ── Week on Week ──────────────────────────────────────────────────────────────
async function renderWoW(container) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">Loading…</p>';
  const limit = wowShowAll ? 'all' : DEFAULT_WOW_LIMIT;
  const data  = await fetch(`/api/analysis/wow?limit=${limit}`).then(r => r.json());

  if (!data.pairs.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">Not enough data for week comparisons.</p>';
    return;
  }

  const tablesHtml = data.pairs.map(pair => {
    const cw = pair.currentWeek;
    const pr = pair.prevRange;
    const cwRange = fmtWeekRange(cw.start, cw.end);
    const prRange = fmtWeekRange(pr.start, pr.end);
    const heading = `W${cw.weekNum}: ${cwRange} vs ${prRange}`;
    return buildVerticalTable(heading, cwRange, prRange, pair.current, pair.prev);
  }).join('');

  const loadBtnHtml = data.total > DEFAULT_WOW_LIMIT && !wowShowAll
    ? `<button class="load-all-btn" id="wow-load-all">Load All Weeks (${data.total} total)</button>`
    : (wowShowAll && data.total > DEFAULT_WOW_LIMIT
        ? `<button class="load-all-btn" id="wow-load-all">Show Less</button>`
        : '');

  container.innerHTML = tablesHtml + loadBtnHtml;

  document.getElementById('wow-load-all')?.addEventListener('click', () => {
    wowShowAll = !wowShowAll;
    renderWoW(container);
  });
}

// ── Month to Date ─────────────────────────────────────────────────────────────
async function renderMTD(container) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">Loading…</p>';
  const data = await fetch('/api/analysis/mtd').then(r => r.json());

  if (!data) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">No data available.</p>';
    return;
  }

  const curColLabel  = `${data.currentLabel} (1–${data.elapsed})`;
  const prevColLabel = `${data.prevLabel} (1–${data.elapsed})`;
  const heading      = `${curColLabel} vs ${prevColLabel}`;
  const subheading   = `Comparing ${data.elapsed} day${data.elapsed !== 1 ? 's' : ''} elapsed in each month`;

  container.innerHTML =
    `<div class="period-subheading" style="margin-bottom:12px">${subheading}</div>` +
    buildVerticalTable(heading, curColLabel, prevColLabel, data.current, data.prev);
}

// ── Custom Range ──────────────────────────────────────────────────────────────
function renderCustomRange(container) {
  const minDate = config.dataStart  || '';
  const maxDate = config.dataCutoff || '';

  container.innerHTML = `
    <div class="custom-range-row">
      <span class="custom-range-label">Range A</span>
      <input type="date" id="custom-start"  class="date-input" min="${minDate}" max="${maxDate}" />
      <span class="custom-range-label">to</span>
      <input type="date" id="custom-end"    class="date-input" min="${minDate}" max="${maxDate}" />
      <span class="custom-range-vs">vs</span>
      <span class="custom-range-label">Range B</span>
      <input type="date" id="custom-cmp-start" class="date-input" min="${minDate}" max="${maxDate}" />
      <span class="custom-range-label">to</span>
      <input type="date" id="custom-cmp-end"   class="date-input" min="${minDate}" max="${maxDate}" />
      <button class="apply-range-btn" id="custom-apply">Apply</button>
    </div>
    <div id="custom-result"></div>
  `;

  document.getElementById('custom-apply')?.addEventListener('click', async () => {
    const start    = document.getElementById('custom-start')?.value;
    const end      = document.getElementById('custom-end')?.value;
    const cmpStart = document.getElementById('custom-cmp-start')?.value;
    const cmpEnd   = document.getElementById('custom-cmp-end')?.value;

    if (!start || !end || start > end || !cmpStart || !cmpEnd || cmpStart > cmpEnd) return;

    const resultEl = document.getElementById('custom-result');
    resultEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px">Loading…</p>';

    const [dataA, dataB] = await Promise.all([
      fetch(`/api/analysis/custom?start=${start}&end=${end}`).then(r => r.json()),
      fetch(`/api/analysis/custom?start=${cmpStart}&end=${cmpEnd}`).then(r => r.json()),
    ]);

    const labelA   = `${fmtDateDMY(dataA.start)} – ${fmtDateDMY(dataA.end)}`;
    const labelB   = `${fmtDateDMY(dataB.start)} – ${fmtDateDMY(dataB.end)}`;
    const heading  = `${labelA} vs ${labelB}`;
    const subheading = `Range A: ${dataA.days} day${dataA.days !== 1 ? 's' : ''} &nbsp;·&nbsp; Range B: ${dataB.days} day${dataB.days !== 1 ? 's' : ''}`;

    resultEl.innerHTML =
      `<div class="period-subheading" style="margin-bottom:12px">${subheading}</div>` +
      buildVerticalTable(heading, labelA, labelB, dataA.metrics, dataB.metrics);
  });
}

// ─── TAB 3: ADS BREAKDOWN ────────────────────────────────────────────────────
function setupTab3() {
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activePlatform = btn.dataset.platform;
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.toggle('active', b.dataset.platform === activePlatform));
      document.getElementById('google-view')?.classList.toggle('hidden', activePlatform !== 'google');
      document.getElementById('meta-view')?.classList.toggle('hidden',   activePlatform !== 'meta');
    });
  });

  document.getElementById('google-apply')?.addEventListener('click', loadGoogleData);
  document.getElementById('meta-apply')?.addEventListener('click',   loadMetaData);
}

async function loadTab3() {
  const [gDates, mDates] = await Promise.all([
    fetch('/api/google/dates').then(r => r.json()),
    fetch('/api/meta-ads/dates').then(r => r.json()),
  ]);

  const defaultStart = config.dataCutoff ? config.dataCutoff.slice(0, 7) + '-01' : gDates.min;
  const defaultEnd   = config.dataCutoff || gDates.max;

  const gStart = document.getElementById('google-start');
  const gEnd   = document.getElementById('google-end');
  if (gStart && gEnd && gDates.min && gDates.max) {
    gStart.min = gDates.min; gStart.max = gDates.max; gStart.value = defaultStart;
    gEnd.min   = gDates.min; gEnd.max   = gDates.max; gEnd.value   = defaultEnd;
    googleDateRange = { start: gStart.value, end: gEnd.value };
  }

  const mStart = document.getElementById('meta-start');
  const mEnd   = document.getElementById('meta-end');
  if (mStart && mEnd && mDates.min && mDates.max) {
    const mDefaultEnd = mDates.max < defaultEnd ? mDates.max : defaultEnd;
    mStart.min = mDates.min; mStart.max = mDates.max; mStart.value = defaultStart;
    mEnd.min   = mDates.min; mEnd.max   = mDates.max; mEnd.value   = mDefaultEnd;
    metaDateRange = { start: mStart.value, end: mEnd.value };
  }

  await Promise.all([loadGoogleData(), loadMetaData()]);
}

async function loadGoogleData() {
  const start = document.getElementById('google-start')?.value;
  const end   = document.getElementById('google-end')?.value;
  if (!start || !end) return;
  googleDateRange = { start, end };

  const data = await fetch(`/api/google?start=${start}&end=${end}`).then(r => r.json());
  currentGoogleData = data;

  const rangeDisplay = document.getElementById('google-range-display');
  if (rangeDisplay) rangeDisplay.textContent = `${fmtDateDMY(data.start)} – ${fmtDateDMY(data.end)}`;

  renderGoogleCards(data);
  renderCampaignTable(data.campaigns);
}

async function loadMetaData() {
  const start = document.getElementById('meta-start')?.value;
  const end   = document.getElementById('meta-end')?.value;
  if (!start || !end) return;
  metaDateRange = { start, end };

  const data = await fetch(`/api/meta-ads?start=${start}&end=${end}`).then(r => r.json());
  currentMetaData = data;

  const rangeDisplay = document.getElementById('meta-range-display');
  if (rangeDisplay) rangeDisplay.textContent = `${fmtDateDMY(data.start)} – ${fmtDateDMY(data.end)}`;

  renderMetaCards(data);
  renderMetaCampaignTable(data.campaigns || []);
}

// ─── Google summary cards (Tab 3) ────────────────────────────────────────────
function renderGoogleCards(data) {
  const container = document.getElementById('google-cards');
  if (!container) return;

  const t   = data.totals;
  const pt  = data.priorTotals;
  const dwd = t.daysWithData || 1;

  const dailyMap = {};
  data.daily.forEach(d => { dailyMap[d.date] = d; });
  const allDates = getDatesInRangeFE(data.start, data.end);

  const cards = [
    { id: 'g-spend',  metricKey: 'cost',        priorKey: 'cost',        title: 'Total Spend',       val: t.cost,        type: 'currency',     zeroFill: true,  sparkFn: d => d.cost        },
    { id: 'g-impr',   metricKey: 'impressions',  priorKey: 'impressions', title: 'Total Impressions', val: t.impressions, type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.impressions },
    { id: 'g-clicks', metricKey: 'clicks',       priorKey: 'clicks',      title: 'Total Clicks',      val: t.clicks,      type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.clicks      },
    { id: 'g-ctr',    metricKey: 'ctr',          priorKey: 'ctr',         title: 'CTR',               val: t.ctr,         type: 'percent',      zeroFill: false, sparkFn: d => d.ctr         },
    { id: 'g-cpc',    metricKey: 'cpc',          priorKey: 'cpc',         title: 'CPC',               val: t.cpc,         type: 'currency',     zeroFill: false, sparkFn: d => d.cpc         },
    { id: 'g-cpm',    metricKey: 'cpm',          priorKey: 'cpm',         title: 'CPM',               val: t.cpm,         type: 'currency',     zeroFill: false, sparkFn: d => d.cpm         },
    { id: 'g-conv',   metricKey: 'conversions',  priorKey: 'conversions', title: 'Total Conversions', val: t.conversions, type: 'integer',      zeroFill: true,  sparkFn: d => d.conversions },
    { id: 'g-sales',  metricKey: 'convValue',    priorKey: 'convValue',   title: 'Google Sales',      val: t.convValue,   type: 'currency',     zeroFill: true,  sparkFn: d => d.convValue   },
    { id: 'g-roas',   metricKey: 'roas',         priorKey: 'roas',        title: 'Google ROAS',       val: t.roas,        type: 'multiplier',   zeroFill: false, sparkFn: d => d.roas        },
  ];

  renderTab3Cards(container, cards, dailyMap, allDates, pt, dwd, data);
}

function renderMetaCards(data) {
  const container = document.getElementById('meta-cards');
  if (!container) return;

  const t   = data.totals;
  const pt  = data.priorTotals;
  const dwd = t.daysWithData || 1;

  const dailyMap = {};
  data.daily.forEach(d => { dailyMap[d.date] = d; });
  const allDates = getDatesInRangeFE(data.start, data.end);

  const cards = [
    { id: 'm-spend',  metricKey: 'spend',           priorKey: 'spend',           title: 'Total Spend',       val: t.spend,          type: 'currency',     zeroFill: true,  sparkFn: d => d.spend          },
    { id: 'm-reach',  metricKey: 'reach',            priorKey: 'reach',           title: 'Total Reach',       val: t.reach,          type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.reach          },
    { id: 'm-impr',   metricKey: 'impressions',      priorKey: 'impressions',     title: 'Total Impressions', val: t.impressions,    type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.impressions    },
    { id: 'm-cpm',    metricKey: 'cpm',              priorKey: 'cpm',             title: 'CPM',               val: t.cpm,            type: 'currency',     zeroFill: false, sparkFn: d => d.cpm            },
    { id: 'm-clicks', metricKey: 'clicks',           priorKey: 'clicks',          title: 'Total Link Clicks', val: t.clicks,         type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.clicks         },
    { id: 'm-cpc',    metricKey: 'cpc',              priorKey: 'cpc',             title: 'CPC',               val: t.cpc,            type: 'currency',     zeroFill: false, sparkFn: d => d.cpc            },
    { id: 'm-ctr',    metricKey: 'ctr',              priorKey: 'ctr',             title: 'CTR',               val: t.ctr,            type: 'percent',      zeroFill: false, sparkFn: d => d.ctr            },
    { id: 'm-purch',  metricKey: 'purchases',        priorKey: 'purchases',       title: 'Total Purchases',   val: t.purchases,      type: 'integer',      zeroFill: true,  sparkFn: d => d.purchases      },
    { id: 'm-sales',  metricKey: 'purchasesValue',   priorKey: 'purchasesValue',  title: 'Meta Sales',        val: t.purchasesValue, type: 'currency',     zeroFill: true,  sparkFn: d => d.purchasesValue },
    { id: 'm-roas',   metricKey: 'roas',             priorKey: 'roas',            title: 'Meta ROAS',         val: t.roas,           type: 'multiplier',   zeroFill: false, sparkFn: d => d.roas           },
    { id: 'm-cpp',    metricKey: 'costPerPurchase',  priorKey: 'costPerPurchase', title: 'Cost Per Purchase', val: t.costPerPurchase,type: 'currency',     zeroFill: false, sparkFn: d => d.purchases > 0 ? d.spend / d.purchases : null },
  ];

  renderTab3Cards(container, cards, dailyMap, allDates, pt, dwd, data);
}

function renderTab3Cards(container, cards, dailyMap, allDates, priorTotals, dwd, rangeData) {
  container.innerHTML = '';

  cards.forEach(def => {
    const priorVal = (priorTotals && def.priorKey) ? priorTotals[def.priorKey] : null;
    const trending = getTrend(def.val, priorVal, def.metricKey);

    const card = document.createElement('div');
    card.className = `card card-secondary ${trending.glowClass}`;
    card.id = `tab3-${def.id}`;

    const avgDay = def.val !== null ? def.val / dwd : null;

    card.innerHTML = `
      <div class="card-title">${def.title}</div>
      <div class="card-value-row">
        <span class="card-main-value num">${formatNumber(def.val, def.type)}</span>
        ${trending.arrow}
      </div>
      <div class="card-sub-lines">
        <div class="card-sub-line">Avg/day: <span class="sub-val">${formatNumber(avgDay, def.type)}</span></div>
      </div>
      <div class="sparkline-wrap">
        <canvas class="sparkline-canvas" id="sparkline-${def.id}"></canvas>
      </div>
    `;
    container.appendChild(card);

    const sparkData = allDates.map(date => {
      const d = dailyMap[date];
      if (!d) return def.zeroFill ? 0 : null;
      const v = def.sparkFn(d);
      return v === undefined ? (def.zeroFill ? 0 : null) : v;
    });
    createSparkline(`sparkline-${def.id}`, sparkData, 24);

    card.addEventListener('click', () => {
      const labels = allDates.map(fmtDateDM);
      const title  = `${def.title} — ${fmtDateDMY(rangeData.start)} to ${fmtDateDMY(rangeData.end)}`;
      openModal(title, labels, sparkData, def.type);
    });
  });

  initCardEffects();
}

// ─── Campaign breakdown table (Tab 3 Google) ─────────────────────────────────
const CAMPAIGN_COLS = [
  { key: 'campaign',     label: 'Campaign Name',  type: 'string' },
  { key: 'campaignType', label: 'Channel Type',   type: 'string' },
  { key: 'cost',         label: 'Spend ($)',       type: 'currency' },
  { key: 'impressions',  label: 'Impressions',     type: 'integer' },
  { key: 'clicks',       label: 'Clicks',          type: 'integer' },
  { key: 'ctr',          label: 'CTR (%)',         type: 'percent' },
  { key: 'cpc',          label: 'CPC ($)',         type: 'currency' },
  { key: 'conversions',  label: 'Conversions',     type: 'integer' },
  { key: 'convValue',    label: 'Conv. Value ($)', type: 'currency' },
  { key: 'roas',         label: 'ROAS (x)',        type: 'multiplier' },
];

function renderCampaignTable(campaigns) {
  const head = document.getElementById('campaign-table-head');
  const body = document.getElementById('campaign-table-body');
  const foot = document.getElementById('campaign-table-foot');
  if (!head || !body || !foot) return;

  const headerRow = document.createElement('tr');
  headerRow.innerHTML = CAMPAIGN_COLS.map(col => {
    const isSorted = campaignSort.col === col.key;
    const arrow    = isSorted ? (campaignSort.dir === 'asc' ? '↑' : '↓') : '';
    const sortable = col.type !== 'string' ? 'th-sortable' : '';
    return `<th class="${sortable}" data-col="${col.key}" data-type="${col.type}">${col.label}${isSorted ? `<span class="sort-arrow">${arrow}</span>` : ''}</th>`;
  }).join('');
  head.innerHTML = '';
  head.appendChild(headerRow);

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[campaignSort.col];
    const bv = b[campaignSort.col];
    if (typeof av === 'string') return campaignSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    const an = av ?? -Infinity;
    const bn = bv ?? -Infinity;
    return campaignSort.dir === 'asc' ? an - bn : bn - an;
  });

  body.innerHTML = sorted.map(c => `
    <tr>
      ${CAMPAIGN_COLS.map(col => {
        if (col.type === 'string') return `<td style="text-align:left;font-family:'Inter',sans-serif">${c[col.key] || ''}</td>`;
        return fmtCell(c[col.key], col.type);
      }).join('')}
    </tr>
  `).join('');

  const totals = {
    campaign: 'TOTAL', campaignType: '',
    cost:        campaigns.reduce((s, c) => s + (c.cost || 0),        0),
    impressions: campaigns.reduce((s, c) => s + (c.impressions || 0), 0),
    clicks:      campaigns.reduce((s, c) => s + (c.clicks || 0),      0),
    conversions: campaigns.reduce((s, c) => s + (c.conversions || 0), 0),
    convValue:   campaigns.reduce((s, c) => s + (c.convValue || 0),   0),
  };
  totals.ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions : null;
  totals.cpc  = totals.clicks > 0      ? totals.cost / totals.clicks        : null;
  totals.roas = totals.cost > 0        ? totals.convValue / totals.cost     : null;

  const footRow = document.createElement('tr');
  footRow.innerHTML = CAMPAIGN_COLS.map(col => {
    if (col.key === 'campaign')     return `<td style="text-align:left;font-family:'Inter',sans-serif;color:var(--accent-neutral)">TOTAL</td>`;
    if (col.key === 'campaignType') return `<td></td>`;
    return fmtCell(totals[col.key], col.type);
  }).join('');
  foot.innerHTML = '';
  foot.appendChild(footRow);

  head.querySelectorAll('.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (campaignSort.col === col) {
        campaignSort.dir = campaignSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        campaignSort.col = col;
        campaignSort.dir = 'desc';
      }
      renderCampaignTable(campaigns);
    });
  });
}

// ─── Meta campaign breakdown table (Tab 3) ───────────────────────────────────
const META_CAMPAIGN_COLS = [
  { key: 'campaign',      label: 'Campaign Name',    type: 'string'     },
  { key: 'spend',         label: 'Spend ($)',         type: 'currency'   },
  { key: 'impressions',   label: 'Impressions',       type: 'integer'    },
  { key: 'reach',         label: 'Reach',             type: 'integer'    },
  { key: 'clicks',        label: 'Link Clicks',       type: 'integer'    },
  { key: 'ctr',           label: 'CTR (%)',           type: 'percent'    },
  { key: 'cpc',           label: 'CPC ($)',           type: 'currency'   },
  { key: 'purchases',     label: 'Purchases',         type: 'integer'    },
  { key: 'purchasesValue',label: 'Conv. Value ($)',   type: 'currency'   },
  { key: 'roas',          label: 'ROAS (x)',          type: 'multiplier' },
];

function renderMetaCampaignTable(campaigns) {
  const head = document.getElementById('meta-campaign-table-head');
  const body = document.getElementById('meta-campaign-table-body');
  const foot = document.getElementById('meta-campaign-table-foot');
  if (!head || !body || !foot) return;

  const headerRow = document.createElement('tr');
  headerRow.innerHTML = META_CAMPAIGN_COLS.map(col => {
    const isSorted = metaCampaignSort.col === col.key;
    const arrow    = isSorted ? (metaCampaignSort.dir === 'asc' ? '↑' : '↓') : '';
    const sortable = col.type !== 'string' ? 'th-sortable' : '';
    return `<th class="${sortable}" data-col="${col.key}" data-type="${col.type}">${col.label}${isSorted ? `<span class="sort-arrow">${arrow}</span>` : ''}</th>`;
  }).join('');
  head.innerHTML = '';
  head.appendChild(headerRow);

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[metaCampaignSort.col];
    const bv = b[metaCampaignSort.col];
    if (typeof av === 'string') return metaCampaignSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    const an = av ?? -Infinity;
    const bn = bv ?? -Infinity;
    return metaCampaignSort.dir === 'asc' ? an - bn : bn - an;
  });

  body.innerHTML = sorted.map(c => `
    <tr>
      ${META_CAMPAIGN_COLS.map(col => {
        if (col.type === 'string') return `<td style="text-align:left;font-family:'Inter',sans-serif">${c[col.key] || ''}</td>`;
        return fmtCell(c[col.key], col.type);
      }).join('')}
    </tr>
  `).join('');

  const totals = {
    campaign:       'TOTAL',
    spend:          campaigns.reduce((s, c) => s + (c.spend          || 0), 0),
    impressions:    campaigns.reduce((s, c) => s + (c.impressions    || 0), 0),
    reach:          campaigns.reduce((s, c) => s + (c.reach          || 0), 0),
    clicks:         campaigns.reduce((s, c) => s + (c.clicks         || 0), 0),
    purchases:      campaigns.reduce((s, c) => s + (c.purchases      || 0), 0),
    purchasesValue: campaigns.reduce((s, c) => s + (c.purchasesValue || 0), 0),
  };
  totals.ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions   : null;
  totals.cpc  = totals.clicks > 0      ? totals.spend / totals.clicks         : null;
  totals.roas = totals.spend > 0       ? totals.purchasesValue / totals.spend : null;

  const footRow = document.createElement('tr');
  footRow.innerHTML = META_CAMPAIGN_COLS.map(col => {
    if (col.key === 'campaign') return `<td style="text-align:left;font-family:'Inter',sans-serif;color:var(--accent-neutral)">TOTAL</td>`;
    return fmtCell(totals[col.key], col.type);
  }).join('');
  foot.innerHTML = '';
  foot.appendChild(footRow);

  head.querySelectorAll('.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (metaCampaignSort.col === col) {
        metaCampaignSort.dir = metaCampaignSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        metaCampaignSort.col = col;
        metaCampaignSort.dir = 'desc';
      }
      renderMetaCampaignTable(campaigns);
    });
  });
}

// ─── Frontend date range helper ───────────────────────────────────────────────
function getDatesInRangeFE(start, end) {
  const dates = [];
  const cur   = new Date(start + 'T00:00:00Z');
  const endD  = new Date(end   + 'T00:00:00Z');
  while (cur <= endD) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// ─── Magic Bento Card Effects ─────────────────────────────────────────────────

// Create spotlight div and attach the ONE global mousemove listener.
// Called once from init(). Handles proximity glow on all .card elements
// and spotlight cursor tracking — no per-card logic needed for these.
function initSpotlight() {
  if (document.getElementById('card-spotlight')) return;
  const el = document.createElement('div');
  el.id = 'card-spotlight';
  document.body.appendChild(el);

  const MAX_DISTANCE = 150;

  document.addEventListener('mousemove', (e) => {
    const spotlight = document.getElementById('card-spotlight');
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Proximity glow on every card; track whether cursor is near any card
    let nearCard = false;
    document.querySelectorAll('.card').forEach(card => {
      const rect = card.getBoundingClientRect();
      const dx = Math.max(rect.left - mouseX, 0, mouseX - rect.right);
      const dy = Math.max(rect.top  - mouseY, 0, mouseY - rect.bottom);
      const distance  = Math.sqrt(dx * dx + dy * dy);
      const intensity = distance === 0 ? 1 : Math.max(0, 1 - distance / MAX_DISTANCE);

      card.style.setProperty('--glow-intensity', intensity);

      const relX = ((mouseX - rect.left) / rect.width)  * 100;
      const relY = ((mouseY - rect.top)  / rect.height) * 100;
      card.style.setProperty('--glow-x', relX + '%');
      card.style.setProperty('--glow-y', relY + '%');

      if (distance === 0) nearCard = true;
    });

    if (spotlight && typeof gsap !== 'undefined') {
      if (nearCard) {
        gsap.to(spotlight, { left: mouseX, top: mouseY, duration: 0.05, ease: 'none', force3D: true, overwrite: 'auto' });
        gsap.to(spotlight, { opacity: 0.7, duration: 0.15, overwrite: false });
      } else {
        gsap.to(spotlight, { opacity: 0, duration: 0.3, overwrite: 'auto' });
      }
    }
  }, { passive: true });

  // Reset all glow when mouse leaves the viewport
  document.documentElement.addEventListener('mouseleave', () => {
    const spotlight = document.getElementById('card-spotlight');
    document.querySelectorAll('.card').forEach(card => {
      card.style.setProperty('--glow-intensity', '0');
    });
    if (spotlight && typeof gsap !== 'undefined') {
      gsap.to(spotlight, { opacity: 0, duration: 0.3, overwrite: 'auto' });
    }
  });
}

// Attach tilt, magnetism, and click-ripple to newly rendered cards.
// Glow and spotlight are handled globally by initSpotlight() — not here.
function initCardEffects() {
  document.querySelectorAll('.card').forEach(card => {
    // Avoid double-binding
    if (card._bentoInit) return;
    card._bentoInit = true;

    // Tilt + magnetism on mousemove
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x  = e.clientX - rect.left;
      const y  = e.clientY - rect.top;
      const cx = rect.width  / 2;
      const cy = rect.height / 2;

      // Effect 3: tilt — real-time tracking feel
      const rotateX = ((y - cy) / cy) * -8;
      const rotateY = ((x - cx) / cx) *  8;
      if (typeof gsap !== 'undefined') {
        gsap.to(card, { rotateX, rotateY, transformPerspective: 1000, duration: 0.05, ease: 'none', force3D: true, overwrite: 'auto' });
      }

      // Effect 4: magnetism
      const magnetX = (x - cx) * 0.04;
      const magnetY = (y - cy) * 0.04;
      if (typeof gsap !== 'undefined') {
        gsap.to(card, { x: magnetX, y: magnetY, duration: 0.15, ease: 'power3.out', force3D: true, overwrite: 'auto' });
      }
    }, { passive: true });

    // Reset tilt + magnetism on mouseleave
    card.addEventListener('mouseleave', () => {
      if (typeof gsap !== 'undefined') {
        gsap.to(card, { rotateX: 0, rotateY: 0, x: 0, y: 0, duration: 0.3, ease: 'power3.out', force3D: true, overwrite: 'auto' });
      }
    });

    // Effect 5: click ripple
    card.addEventListener('click', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Ripple size = 2× max corner distance
      const dx = Math.max(x, rect.width  - x);
      const dy = Math.max(y, rect.height - y);
      const size = Math.sqrt(dx * dx + dy * dy) * 2;

      const ripple = document.createElement('div');
      ripple.style.cssText = `
        position:absolute;
        left:${x}px;top:${y}px;
        width:${size}px;height:${size}px;
        transform:translate(-50%,-50%) scale(0);
        border-radius:50%;
        background:radial-gradient(circle, rgba(0,212,170,0.4) 0%, rgba(0,212,170,0.2) 30%, transparent 70%);
        pointer-events:none;
        z-index:2;
      `;
      card.appendChild(ripple);

      if (typeof gsap !== 'undefined') {
        gsap.to(ripple, {
          scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out',
          onComplete: () => ripple.remove(),
        });
      } else {
        setTimeout(() => ripple.remove(), 800);
      }
    });
  });
}

// ─── Metrics ticker ───────────────────────────────────────────────────────────

let tickerItems = [];

function setupTicker() {
  // Inject strip after the header
  const header = document.querySelector('.site-header');
  if (!header) return;

  const strip = document.createElement('div');
  strip.className = 'ticker-strip';
  strip.id = 'ticker-strip';

  const inner = document.createElement('div');
  inner.className = 'ticker-inner';
  inner.id = 'ticker-inner';

  // Placeholder until real data loads
  const placeholder = [
    'COCOON DASHBOARD', '—', 'LOADING DATA', '···'
  ];
  inner.innerHTML = buildTickerHTML(placeholder.map(t => ({ label: t, val: '' })));
  strip.appendChild(inner);

  // Insert after the warnings container (or after header)
  const warnings = document.getElementById('warnings-container');
  if (warnings) {
    warnings.parentNode.insertBefore(strip, warnings);
  } else {
    header.insertAdjacentElement('afterend', strip);
  }
}

function buildTickerHTML(items) {
  // Duplicate for seamless loop
  const html = items.map(item =>
    `<span class="ticker-item">
      <span class="ticker-label">${item.label}</span>
      ${item.val ? `<span class="ticker-val">${item.val}</span>` : ''}
    </span>`
  ).join('');
  return html + html; // duplicate for infinite scroll
}

function updateTicker(summaryData, month) {
  const inner = document.getElementById('ticker-inner');
  if (!inner || !summaryData) return;

  const c = summaryData.current;
  const monthLabel = fmtMonthShort(month).toUpperCase();

  const items = [
    { label: monthLabel + ' · SALES',      val: formatNumberPlain(c.totalSales, 'currency_abbr') },
    { label: 'ORDERS',                      val: formatNumberPlain(c.orders, 'integer') },
    { label: 'AD SPEND',                    val: formatNumberPlain(c.totalSpend, 'currency_abbr') },
    { label: 'ROI',                         val: formatNumberPlain(c.roi, 'multiplier') },
    { label: 'GOOGLE ROAS',                 val: formatNumberPlain(c.gRoas, 'multiplier') },
    { label: 'META ROAS',                   val: formatNumberPlain(c.mRoas, 'multiplier') },
    { label: 'WEBSITE VISITS',              val: formatNumberPlain(c.visitors, 'integer_abbr') },
    { label: 'AOV',                         val: formatNumberPlain(c.aov, 'currency') },
    { label: 'IMPRESSIONS',                 val: formatNumberPlain(c.totalImpressions, 'integer_abbr') },
    { label: 'CLICKS',                      val: formatNumberPlain(c.totalClicks, 'integer_abbr') },
  ];

  inner.innerHTML = buildTickerHTML(items);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
