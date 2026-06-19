'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const COUNT_UP_DURATION_MS  = 800;   // count-up animation duration
const ABBR_MILLION          = 1_000_000;
const ABBR_THOUSAND         = 1_000;
const DEFAULT_WOW_LIMIT     = 12;    // default weeks shown in Week on Week

// ─── Global state ─────────────────────────────────────────────────────────────
let config              = null;   // /api/config response
let selectedMonth       = null;   // Tab 1 active month (YYYY-MM)
let currentSummaryData  = null;   // last /api/summary response (for modal charts)
let initialAnimDone     = false;  // count-up fires on first page load only

let analysisSubTab      = 'mom'; // active Tab 2 sub-tab
let filterState         = {};    // metric key -> boolean (checked state)

// Tab 3 state
let activePlatform      = 'google';
let googleDateRange     = { start: null, end: null };
let metaDateRange       = { start: null, end: null };
let currentGoogleData   = null;   // last /api/google response (for modal charts)
let currentMetaData     = null;   // last /api/meta-ads response (for modal charts)

// Campaign table sort state
let campaignSort     = { col: 'cost',  dir: 'desc' };
let metaCampaignSort = { col: 'spend', dir: 'desc' };

// WoW expanded state
let wowShowAll = false;

// Pending modal data (set when a card is clicked)
let pendingModal = null;

// ─── Analysis metric definitions ─────────────────────────────────────────────
// Defines the 14 metrics available in the Tab 2 filter panel.
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

/**
 * Universal number formatter. All numeric rendering must go through here.
 * Returns an HTML string with appropriate class for null values.
 * @param {number|null} value
 * @param {string} type - currency|currency_abbr|integer|integer_abbr|multiplier|percent
 * @returns {string}
 */
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

/**
 * Plain-text version of formatNumber (no HTML tags). Used inside Chart.js callbacks.
 */
function formatNumberPlain(value, type) {
  if (value === null || value === undefined || (typeof value === 'number' && (!isFinite(value) || isNaN(value)))) {
    return 'N/A';
  }
  const html = formatNumber(value, type);
  // Strip any HTML tags (only the <span class="na"> case would contain tags)
  return html.replace(/<[^>]+>/g, '');
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Format YYYY-MM-DD as DD/MM/YYYY for display. */
function fmtDateDMY(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Format YYYY-MM-DD as DD/MM for table headers and chart X-axis labels. */
function fmtDateDM(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

/** Format YYYY-MM as "April 2026" style. */
function fmtMonthLong(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const names = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  return `${names[month - 1]} ${year}`;
}

/** Format YYYY-MM as "Apr 2026" style. */
function fmtMonthShort(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[month - 1]} ${year}`;
}

/** Format YYYY-MM-DD as "DD Mon YYYY" e.g. "07 Apr 2026". */
function fmtDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Format a date range as "07 Apr–13 Apr 2026" (year only on end date). */
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
  setupTabs();
  setupModal();
  setupFilterPanel();
  setupAnalysisSubTabs();
  setupTab3();

  // Default selected month: current calendar month, or most recent if not available
  const todayYM = new Date().toISOString().slice(0, 7);
  selectedMonth = (config.availableMonths || []).includes(todayYM)
    ? todayYM
    : (config.availableMonths?.[0] || null);

  await loadTab1();
}

// ─── Warning banners ──────────────────────────────────────────────────────────

/** Render amber warning banners for missing/failed CSV files. */
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

/** Show "Data current to: DD/MM/YYYY" in the footer. */
function setupFooter() {
  const el = document.getElementById('footer-cutoff');
  if (el && config.dataCutoff) {
    el.textContent = `Data current to: ${fmtDateDMY(config.dataCutoff)}`;
  }
}

// ─── Tab management ───────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', b.dataset.tab === tab);
      });
      document.querySelectorAll('.tab-panel').forEach(p => {
        const active = p.id === `tab-${tab}`;
        p.classList.toggle('hidden', !active);
      });
      // Re-render sparklines when returning to Day-Wise (Tab 3 destroys all instances)
      if (tab === 'daywise' && selectedMonth && currentSummaryData) {
        destroyAllSparklines();
        renderPrimaryCards(currentSummaryData);
        renderSecondaryCards(currentSummaryData);
      }
      // Lazy-load analysis and ads tabs on first visit
      if (tab === 'analysis') loadAnalysis();
      if (tab === 'ads')      loadTab3();
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function setupModal() {
  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close');

  // Close on button click
  closeBtn?.addEventListener('click', closeModal);

  // Close on overlay background click
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openModal(title, labels, values, formatType) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-overlay').classList.remove('hidden');
  // Destroy old chart and create new one
  createModalChart(labels, values, formatType, formatNumberPlain);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  destroyModalChart();
}

// ─── TAB 1: DAY-WISE ─────────────────────────────────────────────────────────

/** Populate month selector, bind change handler, then fetch and render. */
async function loadTab1() {
  setupMonthSelector();
  if (!selectedMonth) return;
  await renderTab1(selectedMonth);
}

/** Build <option> elements for the month selector dropdown. */
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

/** Fetch summary + daily data and render all Tab 1 components. */
async function renderTab1(month) {
  const [summaryRes, dailyRes] = await Promise.all([
    fetch(`/api/summary?month=${month}`).then(r => r.json()),
    fetch(`/api/daily?month=${month}`).then(r => r.json()),
  ]);
  currentSummaryData = summaryRes;

  // Destroy all sparklines before re-rendering
  destroyAllSparklines();

  renderPrimaryCards(summaryRes);
  renderSecondaryCards(summaryRes);
  renderDayTable(dailyRes, month, summaryRes);
}

// ─── Count-up animation ───────────────────────────────────────────────────────

/**
 * Animate a numeric element from 0 to targetValue over COUNT_UP_DURATION_MS.
 * Uses requestAnimationFrame. Only fires on first page load (initialAnimDone flag).
 */
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
    const eased    = 1 - Math.pow(1 - progress, 2); // ease-out quadratic
    element.innerHTML = formatNumber(targetValue * eased, type);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.innerHTML = formatNumber(targetValue, type);
    }
  }
  requestAnimationFrame(tick);
}

// ─── Primary card rendering ───────────────────────────────────────────────────

/**
 * Render the 4 primary metric cards (Row 1 of Tab 1).
 * Each card has a main value, sub-lines, sparkline, and click-to-modal.
 */
function renderPrimaryCards(summary) {
  const container = document.getElementById('primary-cards');
  if (!container) return;

  const { current, prev, daysInMonth, daysWithData, sparklines, sparklineDates } = summary;

  // Card definitions
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
      sub: (c) => [
        { label: 'Avg/day ROI', val: c.dailyRoiAvg, type: 'multiplier' },
        { label: 'Projected',
          val: daysWithData > 0
            ? (c.totalSales / daysWithData * daysInMonth) /
              Math.max((c.totalSpend / daysWithData * daysInMonth), 0.0001)
            : null,
          type: 'multiplier' },
      ],
    },
  ];

  container.innerHTML = '';
  cards.forEach(def => {
    const mainVal  = current[def.key];
    const prevVal  = prev[def.key];
    const trending = getTrend(mainVal, prevVal);
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

    // Count-up on the main value element
    const valEl = card.querySelector(`#${def.id}-val`);
    countUp(valEl, mainVal, def.type);

    // Sparkline
    createSparkline(`sparkline-${def.id}`, sparklines[def.sparkKey], 36);

    // Modal on click
    card.addEventListener('click', () => {
      const labels = sparklineDates.map(fmtDateDM);
      const values = sparklines[def.sparkKey];
      const title  = `${def.title} — ${fmtMonthLong(selectedMonth)}`;
      openModal(title, labels, values, def.type);
    });
  });

  initialAnimDone = true;
}

// ─── Secondary card rendering ─────────────────────────────────────────────────

/**
 * Render the 9 secondary metric cards (Row 2 of Tab 1).
 */
function renderSecondaryCards(summary) {
  const container = document.getElementById('secondary-cards');
  if (!container) return;

  const { current, prev, daysInMonth, daysWithData, sparklines, sparklineDates } = summary;

  const cards = [
    { id: 'sc-netSales',         key: 'netSales',         title: 'Net Sales',         type: 'currency',     sparkKey: 'netSales'        },
    { id: 'sc-aov',              key: 'aov',              title: 'AOV',               type: 'currency',     sparkKey: 'aov'             },
    { id: 'sc-gRoas',            key: 'gRoas',            title: 'Google ROAS',       type: 'multiplier',   sparkKey: 'gRoas'           },
    { id: 'sc-mRoas',            key: 'mRoas',            title: 'Meta ROAS',         type: 'multiplier',   sparkKey: 'mRoas'           },
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
    const trending = getTrend(mainVal, prevVal);

    const card = document.createElement('div');
    card.className = `card card-secondary ${trending.glowClass}`;
    card.id = def.id;

    const avgPerDay = daysWithData > 0 ? mainVal / daysWithData : null;
    const projected = daysWithData > 0 ? (mainVal / daysWithData) * daysInMonth : null;

    card.innerHTML = `
      <div class="card-title">${def.title}</div>
      <div class="card-value-row">
        <span class="card-main-value num" id="${def.id}-val">${formatNumber(mainVal, def.type)}</span>
        ${trending.arrow}
      </div>
      <div class="card-sub-lines">
        <div class="card-sub-line">Avg/day: <span class="sub-val">${formatNumber(avgPerDay, def.type)}</span></div>
        <div class="card-sub-line">Projected: <span class="sub-val">${formatNumber(projected, def.type)}</span></div>
      </div>
      <div class="sparkline-wrap">
        <canvas class="sparkline-canvas" id="sparkline-${def.id}"></canvas>
      </div>
    `;
    container.appendChild(card);

    createSparkline(`sparkline-${def.id}`, sparklines[def.sparkKey], 24);

    card.addEventListener('click', () => {
      const labels = sparklineDates.map(fmtDateDM);
      const values = sparklines[def.sparkKey];
      const title  = `${def.title} — ${fmtMonthLong(selectedMonth)}`;
      openModal(title, labels, values, def.type);
    });
  });
}

/** Determine trend glow class and arrow HTML given current/previous values. */
function getTrend(current, prev) {
  if (current === null || prev === null || prev === undefined || current === undefined) {
    return { glowClass: '', arrow: '' };
  }
  if (current > prev) {
    return {
      glowClass: 'glow-positive',
      arrow: '<span class="trend-up">↑</span>',
    };
  }
  if (current < prev) {
    return {
      glowClass: 'glow-negative',
      arrow: '<span class="trend-down">↓</span>',
    };
  }
  return { glowClass: '', arrow: '' };
}

// ─── Day-by-day table ─────────────────────────────────────────────────────────

/**
 * Render the full day-by-day table for the selected month.
 * Includes group headers, column headers, data rows, and MONTH TOTAL tfoot.
 */
function renderDayTable(rows, month, summary) {
  renderDayTableHead();
  renderDayTableBody(rows);
  renderDayTableFoot(rows, summary);
}

/** Build the two-row thead: column group header + column headers. */
function renderDayTableHead() {
  const thead = document.getElementById('day-table-head');
  if (!thead) return;

  // Row 1: column group headers with colored top borders
  const groupRow = document.createElement('tr');
  groupRow.className = 'group-row';
  groupRow.innerHTML = `
    <th rowspan="2" class="col-date">Date</th>
    <th colspan="6" class="group-website">Website</th>
    <th colspan="7" class="group-google">Google Ads</th>
    <th colspan="7" class="group-meta">Meta Ads</th>
    <th colspan="5" class="group-combined">Combined</th>
  `;

  // Row 2: individual column headers
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

/** Build one <tr> per calendar day. Days after DATA_CUTOFF show "—". */
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
      // Percentage values are stored as decimals (0..1); multiply by 100 in formatNumber
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

/** Format a table cell value, showing "—" for null. */
function fmtCell(val, type) {
  if (val === null || val === undefined) return '<td><span class="empty">—</span></td>';
  return `<td>${formatNumber(val, type)}</td>`;
}

/**
 * Build the MONTH TOTAL tfoot row.
 * Sum columns show monthly totals; derived columns show calculated ratios from totals.
 */
function renderDayTableFoot(rows, summary) {
  const tfoot = document.getElementById('day-table-foot');
  if (!tfoot) return;

  // Use current month totals from summary instead of re-summing
  const c = summary.current;

  // Monthly computed ratios from aggregated totals (not averages of daily rows)
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

/** Build the filter panel checkboxes from ANALYSIS_METRICS. */
function setupFilterPanel() {
  // Initialise filter state from defaults
  ANALYSIS_METRICS.forEach(m => { filterState[m.key] = m.defaultChecked; });

  const container = document.getElementById('filter-checkboxes');
  if (!container) return;

  // Group metrics by group label
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

  // Update filter state on change and re-render current analysis sub-tab
  container.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (key) {
      filterState[key] = e.target.checked;
      renderAnalysisContent();
    }
  });

  // Toggle open/close
  document.getElementById('filter-toggle')?.addEventListener('click', () => {
    document.getElementById('filter-panel')?.classList.toggle('open');
  });
  document.getElementById('filter-close')?.addEventListener('click', () => {
    document.getElementById('filter-panel')?.classList.remove('open');
  });
}

function setupAnalysisSubTabs() {
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      analysisSubTab = btn.dataset.subtab;
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.subtab === analysisSubTab));
      renderAnalysisContent();
    });
  });
}

/** Trigger the correct analysis data load based on active sub-tab. */
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

/** Return currently selected metrics from ANALYSIS_METRICS. */
function selectedMetrics() {
  return ANALYSIS_METRICS.filter(m => filterState[m.key]);
}

/**
 * Build an analysis comparison table HTML string.
 * @param {Array} rows - [{label, current: metrics, prev: metrics, isPartial}]
 */
/**
 * Build one vertical comparison table for a single period pair (FIX 3).
 * Each metric is a row; columns are: Metric | Current | Previous | Change | % Change.
 */
function buildVerticalTable(heading, currentColLabel, prevColLabel, current, prev) {
  const metrics = selectedMetrics();
  if (!metrics.length) return '';

  const rows = metrics.map(m => {
    const curr = current[m.key];
    const prv  = prev[m.key];
    const { absChange, pctChange, cls } = computeChange(curr, prv, m.type);
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

/**
 * Build a two-column summary table (no comparison) for Custom Range (FIX 3).
 */
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

/**
 * Compute absolute and percentage change, returning formatted strings and CSS class.
 * Uses proper sign characters: + for positive, − (U+2212) for negative.
 */
function computeChange(curr, prev, type) {
  if (curr === null || prev === null || curr === undefined || prev === undefined) {
    return { absChange: '<span class="na">N/A</span>', pctChange: '<span class="na">N/A</span>', cls: '' };
  }

  const abs  = curr - prev;
  const pct  = prev !== 0 ? abs / Math.abs(prev) : null;
  const up   = abs > 0;
  const dn   = abs < 0;
  const cls  = up ? 'change-pos' : dn ? 'change-neg' : 'change-zero';
  const arrow = up ? '↑' : dn ? '↓' : '→';
  const sign  = abs >= 0 ? '+' : '−';   // Unicode minus for negative
  const mag   = Math.abs(abs);

  let absStr;
  if (type === 'currency') {
    absStr = sign + formatNumber(mag, 'currency');
  } else if (type === 'multiplier') {
    absStr = sign + mag.toFixed(2) + 'x';
  } else if (type === 'percent') {
    // Show change in percentage points
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

/** Render one vertical table per consecutive month pair, sorted most-recent first. */
async function renderMoM(container) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:16px">Loading…</p>';
  const data = await fetch('/api/analysis/mom').then(r => r.json());

  if (!data.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:16px">Not enough data for month comparisons.</p>';
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

/** Render one vertical table per week pair. Partial week at top in amber. */
async function renderWoW(container) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:16px">Loading…</p>';
  const limit = wowShowAll ? 'all' : DEFAULT_WOW_LIMIT;
  const data  = await fetch(`/api/analysis/wow?limit=${limit}`).then(r => r.json());

  if (!data.pairs.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:16px">Not enough data for week comparisons.</p>';
    return;
  }

  const tablesHtml = data.pairs.map(pair => {
    const cw = pair.currentWeek;
    const pr = pair.prevRange;
    const cwRange = fmtWeekRange(cw.start, cw.end);
    const prRange = fmtWeekRange(pr.start, pr.end);
    const partialTag = cw.isPartial ? ' <span class="partial-label">(Partial)</span>' : '';
    const heading = `W${cw.weekNum}${partialTag}: ${cwRange} vs ${prRange}`;
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

/** Single vertical table comparing current vs previous month for the same elapsed days. */
async function renderMTD(container) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:16px">Loading…</p>';
  const data = await fetch('/api/analysis/mtd').then(r => r.json());

  if (!data) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:16px">No data available.</p>';
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

/** Date pickers + single summary table (no comparison) for an arbitrary range. */
function renderCustomRange(container) {
  const minDate = config.dataStart  || '';
  const maxDate = config.dataCutoff || '';

  container.innerHTML = `
    <div class="custom-range-row">
      <span class="custom-range-label">Start</span>
      <input type="date" id="custom-start" class="date-input" min="${minDate}" max="${maxDate}" />
      <span class="custom-range-label">End</span>
      <input type="date" id="custom-end"   class="date-input" min="${minDate}" max="${maxDate}" />
      <button class="apply-range-btn" id="custom-apply">Apply</button>
    </div>
    <div id="custom-result"></div>
  `;

  document.getElementById('custom-apply')?.addEventListener('click', async () => {
    const start = document.getElementById('custom-start')?.value;
    const end   = document.getElementById('custom-end')?.value;
    if (!start || !end || start > end) return;

    const data = await fetch(`/api/analysis/custom?start=${start}&end=${end}`).then(r => r.json());
    const heading    = `${fmtDateDMY(data.start)} to ${fmtDateDMY(data.end)} — Summary`;
    const subheading = `Showing ${data.days} day${data.days !== 1 ? 's' : ''} of data`;

    document.getElementById('custom-result').innerHTML =
      buildCustomSummaryTable(heading, subheading, selectedMetrics(), data.metrics);
  });
}

// ─── TAB 3: ADS BREAKDOWN ────────────────────────────────────────────────────

function setupTab3() {
  // Platform toggle buttons
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activePlatform = btn.dataset.platform;
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.toggle('active', b.dataset.platform === activePlatform));
      document.getElementById('google-view')?.classList.toggle('hidden', activePlatform !== 'google');
      document.getElementById('meta-view')?.classList.toggle('hidden',   activePlatform !== 'meta');
    });
  });

  // Apply buttons for date range pickers
  document.getElementById('google-apply')?.addEventListener('click', loadGoogleData);
  document.getElementById('meta-apply')?.addEventListener('click',   loadMetaData);
}

/** Initialise Tab 3 by loading date bounds then default data. */
async function loadTab3() {
  const [gDates, mDates] = await Promise.all([
    fetch('/api/google/dates').then(r => r.json()),
    fetch('/api/meta-ads/dates').then(r => r.json()),
  ]);

  // Default: first of current month to DATA_CUTOFF_DATE
  const defaultStart = config.dataCutoff ? config.dataCutoff.slice(0, 7) + '-01' : gDates.min;
  const defaultEnd   = config.dataCutoff || gDates.max;

  // Google date picker
  const gStart = document.getElementById('google-start');
  const gEnd   = document.getElementById('google-end');
  if (gStart && gEnd && gDates.min && gDates.max) {
    gStart.min = gDates.min; gStart.max = gDates.max; gStart.value = defaultStart;
    gEnd.min   = gDates.min; gEnd.max   = gDates.max; gEnd.value   = defaultEnd;
    googleDateRange = { start: gStart.value, end: gEnd.value };
  }

  // Meta date picker
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

/** Fetch Google data and render summary cards + campaign table. */
async function loadGoogleData() {
  const start = document.getElementById('google-start')?.value;
  const end   = document.getElementById('google-end')?.value;
  if (!start || !end) return;
  googleDateRange = { start, end };

  const data = await fetch(`/api/google?start=${start}&end=${end}`).then(r => r.json());
  currentGoogleData = data;

  // Update campaign breakdown header range display
  const rangeDisplay = document.getElementById('google-range-display');
  if (rangeDisplay) rangeDisplay.textContent = `${fmtDateDMY(data.start)} – ${fmtDateDMY(data.end)}`;

  renderGoogleCards(data);
  renderCampaignTable(data.campaigns);
}

/** Fetch Meta data and render summary cards + campaign breakdown. */
async function loadMetaData() {
  const start = document.getElementById('meta-start')?.value;
  const end   = document.getElementById('meta-end')?.value;
  if (!start || !end) return;
  metaDateRange = { start, end };

  const data = await fetch(`/api/meta-ads?start=${start}&end=${end}`).then(r => r.json());
  currentMetaData = data;

  const rangeDisplay = document.getElementById('meta-range-display');
  if (rangeDisplay) rangeDisplay.textContent = `${fmtDateDMY(data.start)} \u2013 ${fmtDateDMY(data.end)}`;

  renderMetaCards(data);
  renderMetaCampaignTable(data.campaigns || []);
}

// ─── Google summary cards (Tab 3) ────────────────────────────────────────────

function renderGoogleCards(data) {
  const container = document.getElementById('google-cards');
  if (!container) return;

  destroyAllSparklines();

  const t  = data.totals;
  const pt = data.priorTotals;
  const dwd = t.daysWithData || 1;

  // Build daily lookup for sparklines (date -> metric value)
  const dailyMap = {};
  data.daily.forEach(d => { dailyMap[d.date] = d; });
  const allDates = getDatesInRangeFE(data.start, data.end);

  // zeroFill:true = count/revenue metric (missing day → 0, no gap)
  // zeroFill:false = ratio/derived metric (missing day → null = gap)
  const cards = [
    { id: 'g-spend',  priorKey: 'cost',        title: 'Total Spend',        val: t.cost,        type: 'currency',     zeroFill: true,  sparkFn: d => d.cost        },
    { id: 'g-impr',   priorKey: 'impressions', title: 'Total Impressions',  val: t.impressions, type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.impressions },
    { id: 'g-clicks', priorKey: 'clicks',      title: 'Total Clicks',       val: t.clicks,      type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.clicks      },
    { id: 'g-ctr',    priorKey: 'ctr',         title: 'CTR',                val: t.ctr,         type: 'percent',      zeroFill: false, sparkFn: d => d.ctr         },
    { id: 'g-cpc',    priorKey: 'cpc',         title: 'CPC',                val: t.cpc,         type: 'currency',     zeroFill: false, sparkFn: d => d.cpc         },
    { id: 'g-cpm',    priorKey: 'cpm',         title: 'CPM',                val: t.cpm,         type: 'currency',     zeroFill: false, sparkFn: d => d.cpm         },
    { id: 'g-conv',   priorKey: 'conversions', title: 'Total Conversions',  val: t.conversions, type: 'integer',      zeroFill: true,  sparkFn: d => d.conversions },
    { id: 'g-sales',  priorKey: 'convValue',   title: 'Google Sales',       val: t.convValue,   type: 'currency',     zeroFill: true,  sparkFn: d => d.convValue   },
    { id: 'g-roas',   priorKey: 'roas',        title: 'Google ROAS',        val: t.roas,        type: 'multiplier',   zeroFill: false, sparkFn: d => d.roas        },
  ];

  renderTab3Cards(container, cards, dailyMap, allDates, pt, dwd, data);
}

function renderMetaCards(data) {
  const container = document.getElementById('meta-cards');
  if (!container) return;

  const t  = data.totals;
  const pt = data.priorTotals;
  const dwd = t.daysWithData || 1;

  const dailyMap = {};
  data.daily.forEach(d => { dailyMap[d.date] = d; });
  const allDates = getDatesInRangeFE(data.start, data.end);

  const cards = [
    { id: 'm-spend',  priorKey: 'spend',           title: 'Total Spend',        val: t.spend,          type: 'currency',     zeroFill: true,  sparkFn: d => d.spend          },
    { id: 'm-reach',  priorKey: 'reach',           title: 'Total Reach',        val: t.reach,          type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.reach          },
    { id: 'm-impr',   priorKey: 'impressions',     title: 'Total Impressions',  val: t.impressions,    type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.impressions    },
    { id: 'm-cpm',    priorKey: 'cpm',             title: 'CPM',                val: t.cpm,            type: 'currency',     zeroFill: false, sparkFn: d => d.cpm            },
    { id: 'm-clicks', priorKey: 'clicks',          title: 'Total Link Clicks',  val: t.clicks,         type: 'integer_abbr', zeroFill: true,  sparkFn: d => d.clicks         },
    { id: 'm-cpc',    priorKey: 'cpc',             title: 'CPC',                val: t.cpc,            type: 'currency',     zeroFill: false, sparkFn: d => d.cpc            },
    { id: 'm-ctr',    priorKey: 'ctr',             title: 'CTR',                val: t.ctr,            type: 'percent',      zeroFill: false, sparkFn: d => d.ctr            },
    { id: 'm-purch',  priorKey: 'purchases',       title: 'Total Purchases',    val: t.purchases,      type: 'integer',      zeroFill: true,  sparkFn: d => d.purchases      },
    { id: 'm-sales',  priorKey: 'purchasesValue',  title: 'Meta Sales',         val: t.purchasesValue, type: 'currency',     zeroFill: true,  sparkFn: d => d.purchasesValue },
    { id: 'm-roas',   priorKey: 'roas',            title: 'Meta ROAS',          val: t.roas,           type: 'multiplier',   zeroFill: false, sparkFn: d => d.roas           },
    // Cost Per Purchase = spend / purchases; ratio metric → null when no purchases that day
    { id: 'm-cpp',    priorKey: 'costPerPurchase', title: 'Cost Per Purchase',  val: t.costPerPurchase,type: 'currency',     zeroFill: false, sparkFn: d => d.purchases > 0 ? d.spend / d.purchases : null },
  ];

  renderTab3Cards(container, cards, dailyMap, allDates, pt, dwd, data);
}

/**
 * Generic Tab 3 card renderer.
 * Cards show: main value, avg/day, trend arrow vs prior period, sparkline, click-to-modal.
 */
function renderTab3Cards(container, cards, dailyMap, allDates, priorTotals, dwd, rangeData) {
  // No global destroyAllSparklines() here — createSparkline() handles per-canvas destroy.
  // Clearing the innerHTML removes old canvas elements before new ones are inserted.
  container.innerHTML = '';

  cards.forEach(def => {
    // Look up the prior period value using the explicit priorKey defined in each card
    const priorVal = (priorTotals && def.priorKey) ? priorTotals[def.priorKey] : null;
    const trending = getTrend(def.val, priorVal);

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

    // Sparkline: daily values over selected range.
    // Count/revenue (zeroFill:true): missing day → 0. Ratio (zeroFill:false): missing day → null (gap).
    const sparkData = allDates.map(date => {
      const d = dailyMap[date];
      if (!d) return def.zeroFill ? 0 : null;
      const v = def.sparkFn(d);
      return v === undefined ? (def.zeroFill ? 0 : null) : v;
    });
    createSparkline(`sparkline-${def.id}`, sparkData, 24);

    // Modal on click
    card.addEventListener('click', () => {
      const labels = allDates.map(fmtDateDM);
      const title  = `${def.title} — ${fmtDateDMY(rangeData.start)} to ${fmtDateDMY(rangeData.end)}`;
      openModal(title, labels, sparkData, def.type);
    });
  });
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

  // Header with sort arrows
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = CAMPAIGN_COLS.map(col => {
    const isSorted = campaignSort.col === col.key;
    const arrow    = isSorted ? (campaignSort.dir === 'asc' ? '↑' : '↓') : '';
    const sortable = col.type !== 'string' ? 'th-sortable' : '';
    return `<th class="${sortable}" data-col="${col.key}" data-type="${col.type}">${col.label}${isSorted ? `<span class="sort-arrow">${arrow}</span>` : ''}</th>`;
  }).join('');
  head.innerHTML = '';
  head.appendChild(headerRow);

  // Sort the campaigns
  const sorted = [...campaigns].sort((a, b) => {
    const av = a[campaignSort.col];
    const bv = b[campaignSort.col];
    if (typeof av === 'string') return campaignSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    const an = av ?? -Infinity;
    const bn = bv ?? -Infinity;
    return campaignSort.dir === 'asc' ? an - bn : bn - an;
  });

  // Data rows
  body.innerHTML = sorted.map(c => `
    <tr>
      ${CAMPAIGN_COLS.map(col => {
        if (col.type === 'string') return `<td style="text-align:left;font-family:'DM Sans',sans-serif">${c[col.key] || ''}</td>`;
        return fmtCell(c[col.key], col.type);
      }).join('')}
    </tr>
  `).join('');

  // Totals row
  const totals = {
    campaign: 'TOTAL', campaignType: '',
    cost:        campaigns.reduce((s, c) => s + (c.cost || 0),        0),
    impressions: campaigns.reduce((s, c) => s + (c.impressions || 0), 0),
    clicks:      campaigns.reduce((s, c) => s + (c.clicks || 0),      0),
    conversions: campaigns.reduce((s, c) => s + (c.conversions || 0), 0),
    convValue:   campaigns.reduce((s, c) => s + (c.convValue || 0),   0),
  };
  totals.ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions           : null;
  totals.cpc  = totals.clicks > 0      ? totals.cost / totals.clicks                  : null;
  totals.roas = totals.cost > 0        ? totals.convValue / totals.cost               : null;

  const footRow = document.createElement('tr');
  footRow.innerHTML = CAMPAIGN_COLS.map(col => {
    if (col.key === 'campaign')     return `<td style="text-align:left;font-family:'DM Sans',sans-serif;color:var(--accent-neutral)">TOTAL</td>`;
    if (col.key === 'campaignType') return `<td></td>`;
    return fmtCell(totals[col.key], col.type);
  }).join('');
  foot.innerHTML = '';
  foot.appendChild(footRow);

  // Sort on header click
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

  // Header with sort arrows
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = META_CAMPAIGN_COLS.map(col => {
    const isSorted = metaCampaignSort.col === col.key;
    const arrow    = isSorted ? (metaCampaignSort.dir === 'asc' ? '↑' : '↓') : '';
    const sortable = col.type !== 'string' ? 'th-sortable' : '';
    return `<th class="${sortable}" data-col="${col.key}" data-type="${col.type}">${col.label}${isSorted ? `<span class="sort-arrow">${arrow}</span>` : ''}</th>`;
  }).join('');
  head.innerHTML = '';
  head.appendChild(headerRow);

  // Sort the campaigns
  const sorted = [...campaigns].sort((a, b) => {
    const av = a[metaCampaignSort.col];
    const bv = b[metaCampaignSort.col];
    if (typeof av === 'string') return metaCampaignSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    const an = av ?? -Infinity;
    const bn = bv ?? -Infinity;
    return metaCampaignSort.dir === 'asc' ? an - bn : bn - an;
  });

  // Data rows
  body.innerHTML = sorted.map(c => `
    <tr>
      ${META_CAMPAIGN_COLS.map(col => {
        if (col.type === 'string') return `<td style="text-align:left;font-family:'DM Sans',sans-serif">${c[col.key] || ''}</td>`;
        return fmtCell(c[col.key], col.type);
      }).join('')}
    </tr>
  `).join('');

  // Totals row
  const totals = {
    campaign:       'TOTAL',
    spend:          campaigns.reduce((s, c) => s + (c.spend          || 0), 0),
    impressions:    campaigns.reduce((s, c) => s + (c.impressions    || 0), 0),
    reach:          campaigns.reduce((s, c) => s + (c.reach          || 0), 0),
    clicks:         campaigns.reduce((s, c) => s + (c.clicks         || 0), 0),
    purchases:      campaigns.reduce((s, c) => s + (c.purchases      || 0), 0),
    purchasesValue: campaigns.reduce((s, c) => s + (c.purchasesValue || 0), 0),
  };
  totals.ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions       : null;
  totals.cpc  = totals.clicks > 0      ? totals.spend / totals.clicks             : null;
  totals.roas = totals.spend > 0       ? totals.purchasesValue / totals.spend     : null;

  const footRow = document.createElement('tr');
  footRow.innerHTML = META_CAMPAIGN_COLS.map(col => {
    if (col.key === 'campaign') return `<td style="text-align:left;font-family:'DM Sans',sans-serif;color:var(--accent-neutral)">TOTAL</td>`;
    return fmtCell(totals[col.key], col.type);
  }).join('');
  foot.innerHTML = '';
  foot.appendChild(footRow);

  // Sort on header click
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

/** Generate YYYY-MM-DD array from start to end inclusive (client-side). */
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

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
