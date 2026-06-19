'use strict';

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');

const app = express();
const PORT = 3000;
const PASSWORD = 'CrazyGood!';

// ─── In-memory data stores ───────────────────────────────────────────────────
// Key: YYYY-MM-DD string. Value: aggregated day metrics.
let shopifySalesData = new Map();
let shopifyVisitorsData = new Map();
let googleDailyData = new Map();       // aggregated by day
let googleCampaignRows = [];           // raw campaign-level rows (before day-aggregation)
let metaAdsData = new Map();
let metaCampaignRows = [];           // raw campaign-level rows for Meta breakdown
let pinterestDailyData = new Map();
let pinterestAdRows = [];            // raw ad-level rows for Pinterest breakdown

let DATA_CUTOFF_DATE = null;   // YYYY-MM-DD: min of each file's latest date
let DATA_START_DATE = null;    // YYYY-MM-DD: earliest date across all files
const fileWarnings = [];       // filenames that are missing or failed to parse

let targetsData = new Map();

// ─── CSV parsing helpers ─────────────────────────────────────────────────────

// Parse a float, treating empty/null/whitespace as 0
function safeNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

// Parse an integer, also strips commas (for Google Impr. column)
function safeInt(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseInt(String(val).replace(/,/g, '').trim(), 10);
  return isNaN(n) ? 0 : n;
}

// Validate a date string is YYYY-MM-DD
function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
}

// Parse shopify_sales.csv — headers on row 1, aggregate by Day
function parseShopifySales(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  // Check required columns
  const required = ['Day', 'Total sales', 'Net sales', 'Orders'];
  for (const col of required) {
    if (records.length > 0 && !(col in records[0])) {
      const msg = `shopify_sales.csv: column "${col}" not found`;
      console.warn(msg);
      fileWarnings.push(msg);
    }
  }

  const dayMap = new Map();
  for (const row of records) {
    const day = (row['Day'] || '').trim();
    if (!isValidDate(day)) continue;

    const totalSales = safeNum(row['Total sales']);
    const netSales   = safeNum(row['Net sales']);
    const orders     = safeInt(row['Orders']);

    if (dayMap.has(day)) {
      const e = dayMap.get(day);
      e.totalSales += totalSales;
      e.netSales   += netSales;
      e.orders     += orders;
    } else {
      dayMap.set(day, { totalSales, netSales, orders });
    }
  }

  return { data: dayMap, rowCount: records.length };
}

// Parse shopify_visitors.csv — headers on row 1, one row per day, ignore extra comparison columns
function parseShopifyVisitors(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const required = ['Day', 'Online store visitors', 'Sessions'];
  for (const col of required) {
    if (records.length > 0 && !(col in records[0])) {
      const msg = `shopify_visitors.csv: column "${col}" not found`;
      console.warn(msg);
      fileWarnings.push(msg);
    }
  }

  const dayMap = new Map();
  for (const row of records) {
    const day = (row['Day'] || '').trim();
    if (!isValidDate(day)) continue;
    dayMap.set(day, {
      visitors: safeInt(row['Online store visitors']),
      sessions: safeInt(row['Sessions']),
    });
  }

  return { data: dayMap, rowCount: records.length };
}

// Parse google_ads.csv — detect whether file has Google report header rows
function parseGoogleAds(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstLine = content.split('\n')[0] || '';
  const fromLine = firstLine.trim().startsWith('Campaign type') ? 1 : 3;
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    from_line: fromLine,
    relax_column_count: true,
  });

  const required = ['Day', 'Cost', 'Clicks', 'Impr.', 'Conversions', 'Conv. value', 'Campaign', 'Campaign type'];
  for (const col of required) {
    if (records.length > 0 && !(col in records[0])) {
      const msg = `google_ads.csv: column "${col}" not found`;
      console.warn(msg);
      fileWarnings.push(msg);
    }
  }

  const dayMap = new Map();
  const campaignRows = [];

  for (const row of records) {
    const day = (row['Day'] || '').trim();
    if (!isValidDate(day)) continue;

    const cost        = safeNum(row['Cost']);
    const clicks      = safeInt(row['Clicks']);
    const impressions = safeInt(row['Impr.']);   // safeInt strips commas
    const conversions = safeNum(row['Conversions']);
    const convValue   = safeNum(row['Conv. value']);
    const campaign     = (row['Campaign'] || '').trim();
    const campaignType = (row['Campaign type'] || '').trim();

    // Store campaign-level row for Tab 3 breakdown table
    campaignRows.push({ day, campaign, campaignType, cost, clicks, impressions, conversions, convValue });

    // Aggregate into daily totals
    if (dayMap.has(day)) {
      const e = dayMap.get(day);
      e.cost        += cost;
      e.clicks      += clicks;
      e.impressions += impressions;
      e.conversions += conversions;
      e.convValue   += convValue;
    } else {
      dayMap.set(day, { cost, clicks, impressions, conversions, convValue });
    }
  }

  return { data: dayMap, campaignRows, rowCount: records.length };
}

// Parse meta_ads.csv — has BOM, ad-level rows, aggregate by Day
function parseMetaAds(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });

  const required = ['Day', 'Amount spent (AUD)', 'Impressions', 'Reach', 'Link clicks', 'Purchases', 'Purchases conversion value'];
  for (const col of required) {
    if (records.length > 0 && !(col in records[0])) {
      const msg = `meta_ads.csv: column "${col}" not found`;
      console.warn(msg);
      fileWarnings.push(msg);
    }
  }

  const dayMap = new Map();
  const campaignRows = [];

  for (const row of records) {
    const day = (row['Day'] || '').trim();
    if (!isValidDate(day)) continue;

    const campaign       = (row['Campaign name'] || '').trim();
    // Purchases and Purchases conversion value have many null rows — treat as 0
    const spend          = safeNum(row['Amount spent (AUD)']);
    const impressions    = safeInt(row['Impressions']);
    const reach          = safeInt(row['Reach']);
    const clicks         = safeInt(row['Link clicks']);         // nulls → 0
    const purchases      = safeNum(row['Purchases']);           // nulls → 0
    const purchasesValue = safeNum(row['Purchases conversion value']); // nulls → 0

    // Store campaign-level row for Tab 3 breakdown table
    campaignRows.push({ day, campaign, spend, impressions, reach, clicks, purchases, purchasesValue });

    if (dayMap.has(day)) {

      const e = dayMap.get(day);
      e.spend          += spend;
      e.impressions    += impressions;
      e.reach          += reach;
      e.clicks         += clicks;
      e.purchases      += purchases;
      e.purchasesValue += purchasesValue;
    } else {
      dayMap.set(day, { spend, impressions, reach, clicks, purchases, purchasesValue });
    }
  }

  return { data: dayMap, campaignRows, rowCount: records.length };
}

// Parse pinterest_ads.csv — ad-level rows, aggregate by Date
// NOTE: Pinterest data is isolated — does NOT affect DATA_CUTOFF_DATE.
// Brackets in Result/Cost per result columns are stripped but those fields are not used.
function parsePinterestAds(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  // Strip brackets from a value e.g. "[1.23]" → 1.23
  function safePinNum(val) {
    if (val === null || val === undefined || val === '') return 0;
    const n = parseFloat(String(val).replace(/[\[\]]/g, '').trim());
    return isNaN(n) ? 0 : n;
  }

  const dayMap = new Map();
  const adRows = [];

  for (const row of records) {
    const day = (row['Date'] || '').trim();
    if (!isValidDate(day)) continue;

    // Raw sums only — all ratios (CTR, CPC, CPM, ROAS) are calculated server-side
    const spend          = safePinNum(row['Spend in account currency']);
    const impressions    = safeInt(row['Impressions']);
    const reach          = safeInt(row['Reach']);
    const pinClicks      = safeInt(row['Outbound clicks']);   // clicks to website
    const saves          = safeInt(row['Saves']);
    const engagements    = safeInt(row['Engagements']);
    const purchases      = safePinNum(row['Total conversions (Checkout)']);
    const purchasesValue = safePinNum(row['Total order value (Checkout)']);

    const campaignName = (row['Campaign name'] || '').trim();
    const adGroup      = (row['Ad group name'] || '').trim();

    adRows.push({ day, campaignName, adGroup, spend, impressions, reach, pinClicks, saves, engagements, purchases, purchasesValue });

    // Aggregate into daily totals
    if (dayMap.has(day)) {
      const e = dayMap.get(day);
      e.spend          += spend;
      e.impressions    += impressions;
      e.reach          += reach;
      e.pinClicks      += pinClicks;
      e.saves          += saves;
      e.engagements    += engagements;
      e.purchases      += purchases;
      e.purchasesValue += purchasesValue;
    } else {
      dayMap.set(day, { spend, impressions, reach, pinClicks, saves, engagements, purchases, purchasesValue });
    }
  }

  return { data: dayMap, adRows, rowCount: records.length };
}

// ─── Targets loading ─────────────────────────────────────────────────────────

function parseTargets(filePath) {
  if (!fs.existsSync(filePath)) { console.warn('[MISSING] targets.xlsx'); return; }
  try {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);
    targetsData = new Map();
    for (const row of rows) {
      const month = String(row['Month'] || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      targetsData.set(month, {
        targetSales: safeNum(row['Target Sales (AUD)']),
        targetRoi:   safeNum(row['Target ROI (x)']),
        targetSpend: safeNum(row['Target Spend (AUD)']),
      });
    }
    console.log(`[OK] targets.xlsx: ${targetsData.size} months loaded`);
  } catch (err) { console.error(`[ERROR] targets.xlsx: ${err.message}`); }
}

// ─── Data loading on startup ─────────────────────────────────────────────────

function loadData() {
  const dataDir = path.join(__dirname, 'data');

  const fileDefs = [
    {
      filename: 'shopify_sales.csv',
      parser: parseShopifySales,
      onLoad: (result) => {
        shopifySalesData = result.data;
        return result.rowCount;
      },
    },
    {
      filename: 'shopify_visitors.csv',
      parser: parseShopifyVisitors,
      onLoad: (result) => {
        shopifyVisitorsData = result.data;
        return result.rowCount;
      },
    },
    {
      filename: 'google_ads.csv',
      parser: parseGoogleAds,
      onLoad: (result) => {
        googleDailyData   = result.data;
        googleCampaignRows = result.campaignRows;
        return result.rowCount;
      },
    },
    {
      filename: 'meta_ads.csv',
      parser: parseMetaAds,
      onLoad: (result) => {
        metaAdsData       = result.data;
        metaCampaignRows  = result.campaignRows;
        return result.rowCount;
      },
    },
  ];

  const fileLatestDates   = [];
  const fileEarliestDates = [];

  for (const { filename, parser, onLoad } of fileDefs) {
    const filePath = path.join(dataDir, filename);

    if (!fs.existsSync(filePath)) {
      console.warn(`[MISSING] ${filename}`);
      fileWarnings.push(filename);
      continue;
    }

    try {
      const result  = parser(filePath);
      const rowCount = onLoad(result);
      console.log(`[OK] ${filename}: ${rowCount} rows loaded`);

      const dates = [...result.data.keys()].sort();
      if (dates.length > 0) {
        fileLatestDates.push(dates[dates.length - 1]);
        fileEarliestDates.push(dates[0]);
      }
    } catch (err) {
      console.error(`[ERROR] ${filename}: ${err.message}`);
      fileWarnings.push(filename);
    }
  }

  // DATA_CUTOFF_DATE = minimum of each file's latest date (ensures all sources have data)
  if (fileLatestDates.length > 0) {
    DATA_CUTOFF_DATE = fileLatestDates.sort()[0];
  }

  // DATA_START_DATE = earliest date across all files
  if (fileEarliestDates.length > 0) {
    DATA_START_DATE = fileEarliestDates.sort()[0];
  }

  console.log(`\nDATA_START_DATE:  ${DATA_START_DATE}`);
  console.log(`DATA_CUTOFF_DATE: ${DATA_CUTOFF_DATE}\n`);

  parseTargets(path.join(dataDir, 'targets.xlsx'));

  // Pinterest is loaded separately — isolated from DATA_CUTOFF_DATE calculation
  const pinterestPath = path.join(dataDir, 'pinterest_ads.csv');
  if (fs.existsSync(pinterestPath)) {
    try {
      const result = parsePinterestAds(pinterestPath);
      pinterestDailyData = result.data;
      pinterestAdRows    = result.adRows;
      console.log(`[OK] pinterest_ads.csv: ${result.rowCount} rows loaded`);
    } catch (err) {
      console.error(`[ERROR] pinterest_ads.csv: ${err.message}`);
    }
  } else {
    console.warn('[MISSING] pinterest_ads.csv (Pinterest tab will be empty)');
  }
}

// ─── Metric computation helpers ──────────────────────────────────────────────

// Generate every YYYY-MM-DD between start and end inclusive
function getDatesInRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (cur <= endD) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// All calendar days in a YYYY-MM month that are <= DATA_CUTOFF_DATE
function getDatesInMonth(yearMonth) {
  if (!DATA_CUTOFF_DATE) return [];
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${yearMonth}-${String(d).padStart(2, '0')}`;
    if (ds <= DATA_CUTOFF_DATE) dates.push(ds);
  }
  return dates;
}

// Previous calendar month as YYYY-MM
function getPrevMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

// Aggregate all four data sources for a set of dates
function aggregateMetrics(dates) {
  let totalSales = 0, netSales = 0, orders = 0;
  let visitors = 0, sessions = 0;
  let gCost = 0, gImpressions = 0, gClicks = 0, gConversions = 0, gConvValue = 0;
  let mSpend = 0, mImpressions = 0, mReach = 0, mClicks = 0, mPurchases = 0, mPurchasesValue = 0;
  let daysWithData = 0;

  for (const date of dates) {
    const s  = shopifySalesData.get(date);
    const v  = shopifyVisitorsData.get(date);
    const g  = googleDailyData.get(date);
    const m  = metaAdsData.get(date);

    if (s || v || g || m) daysWithData++;

    if (s) { totalSales += s.totalSales; netSales += s.netSales; orders += s.orders; }
    if (v) { visitors += v.visitors; sessions += v.sessions; }
    if (g) { gCost += g.cost; gImpressions += g.impressions; gClicks += g.clicks; gConversions += g.conversions; gConvValue += g.convValue; }
    if (m) { mSpend += m.spend; mImpressions += m.impressions; mReach += m.reach; mClicks += m.clicks; mPurchases += m.purchases; mPurchasesValue += m.purchasesValue; }
  }

  const totalSpend       = gCost + mSpend;
  const totalImpressions = gImpressions + mImpressions;
  const totalClicks      = gClicks + mClicks;

  return {
    // Raw sums
    totalSales, netSales, orders,
    visitors, sessions,
    gCost, gImpressions, gClicks, gConversions, gConvValue,
    mSpend, mImpressions, mReach, mClicks, mPurchases, mPurchasesValue,
    totalSpend, totalImpressions, totalClicks,
    daysWithData,
    // Derived metrics — null when denominator is 0
    roi:            totalSpend > 0        ? totalSales / totalSpend           : null,
    aov:            orders > 0            ? totalSales / orders               : null,
    gRoas:          gCost > 0             ? gConvValue / gCost                : null,
    mRoas:          mSpend > 0            ? mPurchasesValue / mSpend          : null,
    ctrGoogle:      gImpressions > 0      ? gClicks / gImpressions            : null,
    ctrMeta:        mImpressions > 0      ? mClicks / mImpressions            : null,
    ctrCombined:    totalImpressions > 0  ? totalClicks / totalImpressions    : null,
    cpcGoogle:      gClicks > 0           ? gCost / gClicks                   : null,
    cpcMeta:        mClicks > 0           ? mSpend / mClicks                  : null,
    cpcCombined:    totalClicks > 0       ? totalSpend / totalClicks          : null,
    cpmGoogle:      gImpressions > 0      ? (gCost / gImpressions) * 1000    : null,
    cpmMeta:        mImpressions > 0      ? (mSpend / mImpressions) * 1000   : null,
    cpmCombined:    totalImpressions > 0  ? (totalSpend / totalImpressions) * 1000 : null,
    cvr:            sessions > 0          ? orders / sessions                 : null,
    costPerPurchase: mPurchases > 0       ? mSpend / mPurchases               : null,
  };
}

// Aggregate only Google data for a set of dates
function aggregateGoogleForRange(dates) {
  let cost = 0, impressions = 0, clicks = 0, conversions = 0, convValue = 0, daysWithData = 0;
  for (const date of dates) {
    const g = googleDailyData.get(date);
    if (g) {
      daysWithData++;
      cost        += g.cost;
      impressions += g.impressions;
      clicks      += g.clicks;
      conversions += g.conversions;
      convValue   += g.convValue;
    }
  }
  return {
    cost, impressions, clicks, conversions, convValue, daysWithData,
    ctr:  impressions > 0 ? clicks / impressions            : null,
    cpc:  clicks > 0      ? cost / clicks                   : null,
    cpm:  impressions > 0 ? (cost / impressions) * 1000     : null,
    roas: cost > 0        ? convValue / cost                : null,
  };
}

// Aggregate only Meta data for a set of dates
function aggregateMetaForRange(dates) {
  let spend = 0, impressions = 0, reach = 0, clicks = 0, purchases = 0, purchasesValue = 0, daysWithData = 0;
  for (const date of dates) {
    const m = metaAdsData.get(date);
    if (m) {
      daysWithData++;
      spend          += m.spend;
      impressions    += m.impressions;
      reach          += m.reach;
      clicks         += m.clicks;
      purchases      += m.purchases;
      purchasesValue += m.purchasesValue;
    }
  }
  return {
    spend, impressions, reach, clicks, purchases, purchasesValue, daysWithData,
    ctr:             impressions > 0 ? clicks / impressions             : null,
    cpc:             clicks > 0      ? spend / clicks                   : null,
    cpm:             impressions > 0 ? (spend / impressions) * 1000     : null,
    roas:            spend > 0       ? purchasesValue / spend           : null,
    costPerPurchase: purchases > 0   ? spend / purchases                : null,
  };
}

// Aggregate only Pinterest data for a set of dates — all ratios calculated from raw sums
function aggregatePinterestForRange(dates) {
  let spend = 0, impressions = 0, reach = 0, pinClicks = 0, saves = 0, engagements = 0, purchases = 0, purchasesValue = 0, daysWithData = 0;
  for (const date of dates) {
    const p = pinterestDailyData.get(date);
    if (p) {
      daysWithData++;
      spend          += p.spend;
      impressions    += p.impressions;
      reach          += p.reach;
      pinClicks      += p.pinClicks;
      saves          += p.saves;
      engagements    += p.engagements;
      purchases      += p.purchases;
      purchasesValue += p.purchasesValue;
    }
  }
  return {
    spend, impressions, reach, pinClicks, saves, engagements, purchases, purchasesValue, daysWithData,
    ctr:  impressions > 0  ? pinClicks / impressions          : null,
    cpc:  pinClicks > 0    ? spend / pinClicks                : null,
    cpm:  impressions > 0  ? (spend / impressions) * 1000     : null,
    roas: spend > 0        ? purchasesValue / spend           : null,
  };
}

// Prevent NaN/Infinity/undefined from entering API JSON responses
function sanitize(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' && (!isFinite(val) || isNaN(val))) return null;
  return val;
}

// Sanitize every numeric field in a metrics object
function sanitizeMetrics(m) {
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = sanitize(v);
  }
  return out;
}

// All calendar months that have any data, sorted descending
function getAvailableMonths() {
  if (!DATA_CUTOFF_DATE) return [];
  const monthSet = new Set();
  for (const src of [shopifySalesData, shopifyVisitorsData, googleDailyData, metaAdsData]) {
    for (const date of src.keys()) {
      if (date <= DATA_CUTOFF_DATE) monthSet.add(date.slice(0, 7));
    }
  }
  return [...monthSet].sort().reverse();
}

// Build all Mon–Sun week buckets from first Monday on/after DATA_START_DATE
function buildWeeks() {
  if (!DATA_START_DATE || !DATA_CUTOFF_DATE) return [];

  // Find first Monday on or after DATA_START_DATE
  let cur = new Date(DATA_START_DATE + 'T00:00:00Z');
  const dow = cur.getUTCDay(); // 0=Sun 1=Mon ... 6=Sat
  if (dow !== 1) {
    const daysToAdd = dow === 0 ? 1 : 8 - dow;
    cur.setUTCDate(cur.getUTCDate() + daysToAdd);
  }

  const cutoff = new Date(DATA_CUTOFF_DATE + 'T00:00:00Z');
  const weeks  = [];
  let weekNum  = 1;

  while (cur <= cutoff) {
    const weekStart = cur.toISOString().slice(0, 10);
    const endD      = new Date(cur);
    endD.setUTCDate(endD.getUTCDate() + 6);
    const weekEnd = endD.toISOString().slice(0, 10);

    if (endD <= cutoff) {
      // Complete Mon–Sun week
      weeks.push({ weekNum, start: weekStart, end: weekEnd, isPartial: false });
    } else {
      // Partial week: Monday to DATA_CUTOFF_DATE
      weeks.push({ weekNum, start: weekStart, end: DATA_CUTOFF_DATE, isPartial: true });
    }

    cur.setUTCDate(cur.getUTCDate() + 7);
    weekNum++;
  }

  return weeks.reverse(); // descending: most recent first
}

// Compute the prior equivalent range given a start/end date range
function priorRangeFor(start, end) {
  const rangeLen   = getDatesInRange(start, end).length;
  const priorEndD  = new Date(start + 'T00:00:00Z');
  priorEndD.setUTCDate(priorEndD.getUTCDate() - 1);
  const priorStartD = new Date(priorEndD);
  priorStartD.setUTCDate(priorStartD.getUTCDate() - rangeLen + 1);
  return {
    start: priorStartD.toISOString().slice(0, 10),
    end:   priorEndD.toISOString().slice(0, 10),
  };
}

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: 'cocoon-dashboard-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

// Auth guard — runs before static files and all API routes
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (req.session && req.session.isAuthenticated) return next();
  return res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Routes ─────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  const error = req.query.error ? '<p class="login-error">Incorrect password. Try again.</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cocoon Dashboard — Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg-primary:      #000000;
      --bg-secondary:    #0a0a0a;
      --border-subtle:   #1f1f1f;
      --border-accent:   #2a2a2a;
      --text-primary:    #f0f0f0;
      --text-secondary:  #888888;
      --text-muted:      #444444;
      --accent-positive: #00d4aa;
      --accent-negative: #f59e0b;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-primary);
      background-image:
        linear-gradient(rgba(0, 212, 170, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 212, 170, 0.025) 1px, transparent 1px);
      background-size: 44px 44px;
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9998;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.025) 2px,
        rgba(0, 0, 0, 0.025) 3px
      );
    }
    .login-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 40px 36px;
      width: 100%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      position: relative;
      z-index: 1;
    }
    .login-logo {
      height: 32px;
      width: auto;
    }
    .login-logo-fallback {
      font-family: 'Inter', sans-serif;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: 0.04em;
    }
    .login-logo-fallback span { color: var(--accent-positive); }
    form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    label {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    input[type="password"] {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      background: #111111;
      border: 1px solid var(--border-accent);
      border-radius: 4px;
      color: var(--text-primary);
      padding: 10px 12px;
      width: 100%;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="password"]:focus {
      border-color: var(--accent-positive);
    }
    button[type="submit"] {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.04em;
      background: var(--accent-positive);
      color: #000000;
      border: none;
      border-radius: 4px;
      padding: 10px 16px;
      width: 100%;
      cursor: pointer;
      transition: opacity 0.15s;
      margin-top: 4px;
    }
    button[type="submit"]:hover { opacity: 0.85; }
    .login-error {
      font-size: 12px;
      color: var(--accent-negative);
      text-align: center;
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <img src="/logo.png" alt="Cocoon Dashboard" class="login-logo"
         onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div class="login-logo-fallback" style="display:none">Cocoon <span>Dashboard</span></div>
    <form method="POST" action="/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" autofocus />
      <button type="submit">Enter Dashboard</button>
    </form>
    ${error}
  </div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === PASSWORD) {
    req.session.isAuthenticated = true;
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ─── API Routes ──────────────────────────────────────────────────────────────

// Config: dates, available months, warnings
app.get('/api/config', (req, res) => {
  res.json({
    dataCutoff:      DATA_CUTOFF_DATE,
    dataStart:       DATA_START_DATE,
    availableMonths: getAvailableMonths(),
    availableWeeks:  buildWeeks(),
    warnings:        fileWarnings,
  });
});

// One row per calendar day in the selected month (≤ DATA_CUTOFF_DATE)
app.get('/api/daily', (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month parameter. Use YYYY-MM.' });
  }

  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const rows = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    const hasData = DATA_CUTOFF_DATE && dateStr <= DATA_CUTOFF_DATE;

    if (!hasData) {
      rows.push({ date: dateStr, hasData: false });
      continue;
    }

    const s  = shopifySalesData.get(dateStr)    || { totalSales: 0, netSales: 0, orders: 0 };
    const v  = shopifyVisitorsData.get(dateStr) || { visitors: 0, sessions: 0 };
    const g  = googleDailyData.get(dateStr)     || { cost: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 };
    const m  = metaAdsData.get(dateStr)         || { spend: 0, impressions: 0, reach: 0, clicks: 0, purchases: 0, purchasesValue: 0 };

    const totalSpend       = g.cost + m.spend;
    const totalImpressions = g.impressions + m.impressions;
    const totalClicks      = g.clicks + m.clicks;

    rows.push({
      date:    dateStr,
      hasData: true,
      // Website
      totalSales: sanitize(s.totalSales),
      netSales:   sanitize(s.netSales),
      orders:     sanitize(s.orders),
      aov:        sanitize(s.orders > 0 ? s.totalSales / s.orders : null),
      sessions:   sanitize(v.sessions),
      visitors:   sanitize(v.visitors),
      // Google
      gCost:        sanitize(g.cost),
      gImpressions: sanitize(g.impressions),
      gClicks:      sanitize(g.clicks),
      gCtr:         sanitize(g.impressions > 0 ? g.clicks / g.impressions : null),
      gConversions: sanitize(g.conversions),
      gSales:       sanitize(g.convValue),
      gRoas:        sanitize(g.cost > 0 ? g.convValue / g.cost : null),
      // Meta
      mSpend:       sanitize(m.spend),
      mImpressions: sanitize(m.impressions),
      mClicks:      sanitize(m.clicks),
      mCtr:         sanitize(m.impressions > 0 ? m.clicks / m.impressions : null),
      mPurchases:   sanitize(m.purchases),
      mSales:       sanitize(m.purchasesValue),
      mRoas:        sanitize(m.spend > 0 ? m.purchasesValue / m.spend : null),
      // Combined
      totalSpend:       sanitize(totalSpend),
      totalImpressions: sanitize(totalImpressions),
      totalClicks:      sanitize(totalClicks),
      totalCtr:         sanitize(totalImpressions > 0 ? totalClicks / totalImpressions : null),
      roi:              sanitize(totalSpend > 0 ? s.totalSales / totalSpend : null),
    });
  }

  res.json(rows);
});

// Monthly totals for Tab 1 card population, plus sparkline series
app.get('/api/summary', (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month parameter. Use YYYY-MM.' });
  }

  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  const currentDates = getDatesInMonth(month);
  const prevDates    = getDatesInMonth(getPrevMonth(month));

  const current = aggregateMetrics(currentDates);
  const prev    = aggregateMetrics(prevDates);

  // Compute mean of each individual day's ROI (not ratio of totals) — Tab 1 Card 4 sub-line
  let dailyRoiSum = 0, dailyRoiCount = 0;
  for (const date of currentDates) {
    const s  = shopifySalesData.get(date);
    const g  = googleDailyData.get(date);
    const m2 = metaAdsData.get(date);
    if (s) {
      const daySpend = (g?.cost || 0) + (m2?.spend || 0);
      if (daySpend > 0) { dailyRoiSum += s.totalSales / daySpend; dailyRoiCount++; }
    }
  }
  const dailyRoiAvg = dailyRoiCount > 0 ? dailyRoiSum / dailyRoiCount : null;

  // Sparkline series: only days up to DATA_CUTOFF_DATE — no future blank dates on charts (FIX 2)
  const sparklineDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    if (DATA_CUTOFF_DATE && ds > DATA_CUTOFF_DATE) break; // stop at cutoff
    sparklineDates.push(ds);
  }

  // Build sparkline arrays.
  // Count/revenue metrics: missing days → 0 (no gap). Ratio metrics: missing → null (gap). (FIX 1)
  const sparklines = {
    totalSales: [], orders: [], totalSpend: [], roi: [],
    netSales: [], aov: [], gRoas: [], mRoas: [],
    totalImpressions: [], totalClicks: [], visitors: [],
    metaSales: [], googleSales: [],
  };

  let cumRoiSales = 0, cumRoiSpend = 0;
  let cumGConvValue = 0, cumGCost = 0;
  let cumMPurchasesValue = 0, cumMSpend = 0;

  for (const date of sparklineDates) {
    // All dates are guaranteed <= DATA_CUTOFF_DATE after the loop above
    const s  = shopifySalesData.get(date);
    const v  = shopifyVisitorsData.get(date);
    const g  = googleDailyData.get(date);
    const m2 = metaAdsData.get(date);

    const daySpend = (g?.cost || 0) + (m2?.spend || 0);

    cumRoiSales        += (s?.totalSales ?? 0);
    cumRoiSpend        += daySpend;
    cumGConvValue      += (g?.convValue ?? 0);
    cumGCost           += (g?.cost ?? 0);
    cumMPurchasesValue += (m2?.purchasesValue ?? 0);
    cumMSpend          += (m2?.spend ?? 0);

    sparklines.totalSales.push(sanitize(s?.totalSales ?? 0));
    sparklines.orders.push(sanitize(s?.orders ?? 0));
    sparklines.totalSpend.push(sanitize(daySpend));
    sparklines.roi.push(sanitize(cumRoiSpend > 0 ? cumRoiSales / cumRoiSpend : null));
    sparklines.netSales.push(sanitize(s?.netSales ?? 0));
    sparklines.aov.push(sanitize((s?.orders ?? 0) > 0 ? (s?.totalSales ?? 0) / (s?.orders ?? 0) : null));
    sparklines.gRoas.push(sanitize(cumGCost > 0 ? cumGConvValue / cumGCost : null));
    sparklines.mRoas.push(sanitize(cumMSpend > 0 ? cumMPurchasesValue / cumMSpend : null));
    sparklines.totalImpressions.push(sanitize((g?.impressions ?? 0) + (m2?.impressions ?? 0)));
    sparklines.totalClicks.push(sanitize((g?.clicks ?? 0) + (m2?.clicks ?? 0)));
    sparklines.visitors.push(sanitize(v?.visitors ?? 0));
    sparklines.metaSales.push(sanitize(m2?.purchasesValue ?? 0));
    sparklines.googleSales.push(sanitize(g?.convValue ?? 0));
  }

  res.json({
    current:       sanitizeMetrics({ ...current, dailyRoiAvg }),
    prev:          sanitizeMetrics(prev),
    daysInMonth,
    daysWithData:  current.daysWithData,
    sparklines,
    sparklineDates,
  });
});

// All month-on-month pairs, sorted descending
app.get('/api/analysis/mom', (req, res) => {
  const months = getAvailableMonths().slice().reverse(); // ascending for pairing
  const pairs  = [];

  for (let i = 1; i < months.length; i++) {
    const currentMonth = months[i];
    const prevMonth    = months[i - 1];
    pairs.push({
      currentMonth,
      prevMonth,
      current: sanitizeMetrics(aggregateMetrics(getDatesInMonth(currentMonth))),
      prev:    sanitizeMetrics(aggregateMetrics(getDatesInMonth(prevMonth))),
    });
  }

  pairs.reverse(); // most recent pair first
  const nowMom = new Date();
  const currentCalMonth = `${nowMom.getFullYear()}-${String(nowMom.getMonth() + 1).padStart(2, '0')}`;
  res.json(pairs.filter(p => p.currentMonth !== currentCalMonth));
});

// Week-on-week pairs, sorted descending; limit defaults to 12
app.get('/api/analysis/wow', (req, res) => {
  const { limit } = req.query;
  const allWeeks = buildWeeks().filter(w => !w.isPartial); // complete Mon–Sun weeks only
  const pairs    = [];

  for (let i = 0; i < allWeeks.length; i++) {
    const cw = allWeeks[i];

    // Prior equivalent range: same number of days, immediately preceding cw.start
    const pr = priorRangeFor(cw.start, cw.end);

    // Skip if prior range is entirely before DATA_START_DATE
    if (DATA_START_DATE && pr.end < DATA_START_DATE) continue;

    const currentDates = getDatesInRange(cw.start, cw.end).filter(d => d <= DATA_CUTOFF_DATE);
    const priorDates   = getDatesInRange(pr.start, pr.end).filter(d => DATA_START_DATE ? d >= DATA_START_DATE : true);

    pairs.push({
      currentWeek: cw,
      prevRange:   pr,
      current: sanitizeMetrics(aggregateMetrics(currentDates)),
      prev:    sanitizeMetrics(aggregateMetrics(priorDates)),
    });
  }

  const limitNum = limit === 'all' ? pairs.length : (parseInt(limit, 10) || 12);
  res.json({ pairs: pairs.slice(0, limitNum), total: pairs.length });
});

// Month-to-date: current calendar month days 1–N vs previous month days 1–N
app.get('/api/analysis/mtd', (req, res) => {
  if (!DATA_CUTOFF_DATE) return res.json(null);

  const cutoffD  = new Date(DATA_CUTOFF_DATE + 'T00:00:00Z');
  const curYear  = cutoffD.getUTCFullYear();
  const curMonth = cutoffD.getUTCMonth() + 1; // 1-based
  const elapsed  = cutoffD.getUTCDate();

  const pad = n => String(n).padStart(2, '0');

  const currentDates = [];
  for (let d = 1; d <= elapsed; d++) {
    currentDates.push(`${curYear}-${pad(curMonth)}-${pad(d)}`);
  }

  let prevYear  = curYear;
  let prevMonth = curMonth - 1;
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }

  const prevDates = [];
  for (let d = 1; d <= elapsed; d++) {
    prevDates.push(`${prevYear}-${pad(prevMonth)}-${pad(d)}`);
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  res.json({
    current:      sanitizeMetrics(aggregateMetrics(currentDates)),
    prev:         sanitizeMetrics(aggregateMetrics(prevDates)),
    elapsed,
    currentLabel: `${MONTH_NAMES[curMonth - 1]} ${curYear}`,
    prevLabel:    `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`,
  });
});

// Custom date range summary
app.get('/api/analysis/custom', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ error: 'Invalid start or end date.' });
  }
  const effectiveEnd = DATA_CUTOFF_DATE && end > DATA_CUTOFF_DATE ? DATA_CUTOFF_DATE : end;
  const dates  = getDatesInRange(start, effectiveEnd);
  res.json({
    metrics: sanitizeMetrics(aggregateMetrics(dates)),
    start,
    end:  effectiveEnd,
    days: dates.length,
  });
});

// Google Ads data for Tab 3: daily totals + campaign breakdown
app.get('/api/google', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ error: 'Invalid start or end date.' });
  }
  const effectiveEnd = DATA_CUTOFF_DATE && end > DATA_CUTOFF_DATE ? DATA_CUTOFF_DATE : end;
  const dates    = getDatesInRange(start, effectiveEnd);
  const dateSet  = new Set(dates);

  // Daily series for sparklines
  const daily = [];
  let gCumConvValue = 0, gCumCost = 0;
  for (const date of dates) {
    const g = googleDailyData.get(date);
    if (g) {
      gCumConvValue += g.convValue;
      gCumCost      += g.cost;
      daily.push({
        date,
        cost:        sanitize(g.cost),
        impressions: sanitize(g.impressions),
        clicks:      sanitize(g.clicks),
        conversions: sanitize(g.conversions),
        convValue:   sanitize(g.convValue),
        ctr:  sanitize(g.impressions > 0 ? g.clicks / g.impressions : null),
        cpc:  sanitize(g.clicks > 0      ? g.cost / g.clicks : null),
        cpm:  sanitize(g.impressions > 0 ? (g.cost / g.impressions) * 1000 : null),
        roas: sanitize(gCumCost > 0      ? gCumConvValue / gCumCost : null),
      });
    }
  }

  // Campaign breakdown — aggregate campaign totals for selected range
  const campaignMap = new Map();
  for (const row of googleCampaignRows) {
    if (!dateSet.has(row.day)) continue;
    if (!campaignMap.has(row.campaign)) {
      campaignMap.set(row.campaign, {
        campaign: row.campaign, campaignType: row.campaignType,
        cost: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0,
      });
    }
    const e = campaignMap.get(row.campaign);
    e.cost        += row.cost;
    e.impressions += row.impressions;
    e.clicks      += row.clicks;
    e.conversions += row.conversions;
    e.convValue   += row.convValue;
  }
  const campaigns = [...campaignMap.values()].map(c => ({
    ...c,
    ctr:  sanitize(c.impressions > 0 ? c.clicks / c.impressions : null),
    cpc:  sanitize(c.clicks > 0      ? c.cost / c.clicks : null),
    roas: sanitize(c.cost > 0        ? c.convValue / c.cost : null),
  }));

  // Range totals
  const totals = sanitizeMetrics(aggregateGoogleForRange(dates));

  // Prior equivalent range for trend arrows
  const pr = priorRangeFor(start, effectiveEnd);
  let priorTotals = null;
  if (DATA_START_DATE && pr.start >= DATA_START_DATE) {
    priorTotals = sanitizeMetrics(aggregateGoogleForRange(getDatesInRange(pr.start, pr.end)));
  }

  res.json({ daily, campaigns, totals, priorTotals, start, end: effectiveEnd });
});

// Meta Ads data for Tab 3: daily totals + campaign breakdown (RB campaigns only)
app.get('/api/meta-ads', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ error: 'Invalid start or end date.' });
  }
  const effectiveEnd = DATA_CUTOFF_DATE && end > DATA_CUTOFF_DATE ? DATA_CUTOFF_DATE : end;
  const dates   = getDatesInRange(start, effectiveEnd);
  const dateSet = new Set(dates);

  // Daily series for sparklines
  const daily = [];
  let mCumPurchasesValue = 0, mCumSpend = 0;
  for (const date of dates) {
    const m = metaAdsData.get(date);
    if (m) {
      mCumPurchasesValue += m.purchasesValue;
      mCumSpend          += m.spend;
      daily.push({
        date,
        spend:          sanitize(m.spend),
        impressions:    sanitize(m.impressions),
        reach:          sanitize(m.reach),
        clicks:         sanitize(m.clicks),
        purchases:      sanitize(m.purchases),
        purchasesValue: sanitize(m.purchasesValue),
        ctr:  sanitize(m.impressions > 0 ? m.clicks / m.impressions : null),
        cpc:  sanitize(m.clicks > 0      ? m.spend / m.clicks : null),
        cpm:  sanitize(m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null),
        roas: sanitize(mCumSpend > 0     ? mCumPurchasesValue / mCumSpend : null),
      });
    }
  }

  // Campaign breakdown — only campaigns whose name starts with "RB"
  const campaignMap = new Map();
  for (const row of metaCampaignRows) {
    if (!dateSet.has(row.day)) continue;
    if (!row.campaign.startsWith('RB')) continue;
    if (!campaignMap.has(row.campaign)) {
      campaignMap.set(row.campaign, {
        campaign: row.campaign,
        spend: 0, impressions: 0, reach: 0, clicks: 0, purchases: 0, purchasesValue: 0,
      });
    }
    const e = campaignMap.get(row.campaign);
    e.spend          += row.spend;
    e.impressions    += row.impressions;
    e.reach          += row.reach;
    e.clicks         += row.clicks;
    e.purchases      += row.purchases;
    e.purchasesValue += row.purchasesValue;
  }
  const campaigns = [...campaignMap.values()].map(c => ({
    ...c,
    ctr:  sanitize(c.impressions > 0 ? c.clicks / c.impressions : null),
    cpc:  sanitize(c.clicks > 0      ? c.spend / c.clicks : null),
    roas: sanitize(c.spend > 0       ? c.purchasesValue / c.spend : null),
  }));

  const totals = sanitizeMetrics(aggregateMetaForRange(dates));

  // Prior equivalent range for trend arrows
  const pr = priorRangeFor(start, effectiveEnd);
  let priorTotals = null;
  if (DATA_START_DATE && pr.start >= DATA_START_DATE) {
    priorTotals = sanitizeMetrics(aggregateMetaForRange(getDatesInRange(pr.start, pr.end)));
  }

  res.json({ daily, campaigns, totals, priorTotals, start, end: effectiveEnd });
});

// Min/max selectable dates for the Google Tab 3 date picker
app.get('/api/google/dates', (req, res) => {
  const dates = [...googleDailyData.keys()].filter(d => !DATA_CUTOFF_DATE || d <= DATA_CUTOFF_DATE).sort();
  res.json({ min: dates[0] || null, max: dates[dates.length - 1] || null });
});

// Min/max selectable dates for the Meta Tab 3 date picker
app.get('/api/meta-ads/dates', (req, res) => {
  const dates = [...metaAdsData.keys()].filter(d => !DATA_CUTOFF_DATE || d <= DATA_CUTOFF_DATE).sort();
  res.json({ min: dates[0] || null, max: dates[dates.length - 1] || null });
});

// Min/max selectable dates for the Pinterest Tab 3 date picker
// Pinterest is not capped by DATA_CUTOFF_DATE — uses its own date range
app.get('/api/pinterest/dates', (req, res) => {
  const dates = [...pinterestDailyData.keys()].sort();
  res.json({ min: dates[0] || null, max: dates[dates.length - 1] || null });
});

// Pinterest Ads data for Tab 3: daily totals + ad breakdown
app.get('/api/pinterest', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ error: 'Invalid start or end date.' });
  }

  const pinterestDates = [...pinterestDailyData.keys()].sort();
  const pinterestMax   = pinterestDates[pinterestDates.length - 1] || end;
  const effectiveEnd   = end > pinterestMax ? pinterestMax : end;
  const dates          = getDatesInRange(start, effectiveEnd);
  const dateSet        = new Set(dates);

  // Daily series for sparklines — cumulative ROAS
  const daily = [];
  let cumPurchasesValue = 0, cumSpend = 0;
  for (const date of dates) {
    const p = pinterestDailyData.get(date);
    if (p) {
      cumPurchasesValue += p.purchasesValue;
      cumSpend          += p.spend;
      daily.push({
        date,
        spend:          sanitize(p.spend),
        impressions:    sanitize(p.impressions),
        reach:          sanitize(p.reach),
        pinClicks:      sanitize(p.pinClicks),
        saves:          sanitize(p.saves),
        engagements:    sanitize(p.engagements),
        purchases:      sanitize(p.purchases),
        purchasesValue: sanitize(p.purchasesValue),
        ctr:  sanitize(p.impressions > 0 ? p.pinClicks / p.impressions : null),
        cpc:  sanitize(p.pinClicks > 0   ? p.spend / p.pinClicks : null),
        cpm:  sanitize(p.impressions > 0 ? (p.spend / p.impressions) * 1000 : null),
        roas: sanitize(cumSpend > 0      ? cumPurchasesValue / cumSpend : null),
      });
    }
  }

  // Campaign breakdown — aggregate by campaign, then by ad group within campaign
  const campaignMap = new Map();
  for (const row of pinterestAdRows) {
    if (!dateSet.has(row.day)) continue;
    const cKey = row.campaignName;
    if (!campaignMap.has(cKey)) {
      campaignMap.set(cKey, {
        name: row.campaignName, type: 'campaign',
        spend: 0, impressions: 0, reach: 0, pinClicks: 0, saves: 0, engagements: 0, purchases: 0, purchasesValue: 0,
        adGroups: new Map(),
      });
    }
    const c = campaignMap.get(cKey);
    c.spend += row.spend; c.impressions += row.impressions; c.reach += row.reach;
    c.pinClicks += row.pinClicks; c.saves += row.saves; c.engagements += row.engagements;
    c.purchases += row.purchases; c.purchasesValue += row.purchasesValue;

    const agKey = row.adGroup;
    if (!c.adGroups.has(agKey)) {
      c.adGroups.set(agKey, {
        name: row.adGroup, type: 'adgroup', campaignName: row.campaignName,
        spend: 0, impressions: 0, reach: 0, pinClicks: 0, saves: 0, engagements: 0, purchases: 0, purchasesValue: 0,
      });
    }
    const ag = c.adGroups.get(agKey);
    ag.spend += row.spend; ag.impressions += row.impressions; ag.reach += row.reach;
    ag.pinClicks += row.pinClicks; ag.saves += row.saves; ag.engagements += row.engagements;
    ag.purchases += row.purchases; ag.purchasesValue += row.purchasesValue;
  }

  // Flatten into ordered array: campaign row, then its ad group rows (sorted by spend desc)
  const addRatios = obj => ({
    ...obj,
    ctr:  sanitize(obj.impressions > 0 ? obj.pinClicks / obj.impressions : null),
    cpc:  sanitize(obj.pinClicks > 0   ? obj.spend / obj.pinClicks : null),
    cpm:  sanitize(obj.impressions > 0 ? (obj.spend / obj.impressions) * 1000 : null),
    roas: sanitize(obj.spend > 0       ? obj.purchasesValue / obj.spend : null),
  });

  const ads = [];
  for (const camp of [...campaignMap.values()].sort((a, b) => b.spend - a.spend)) {
    const { adGroups, ...campData } = camp;
    ads.push(addRatios(campData));
    const sortedGroups = [...adGroups.values()].sort((a, b) => b.spend - a.spend);
    for (const ag of sortedGroups) ads.push(addRatios(ag));
  }

  const totals     = sanitizeMetrics(aggregatePinterestForRange(dates));
  const pr         = priorRangeFor(start, effectiveEnd);
  const priorDates = getDatesInRange(pr.start, pr.end).filter(d => pinterestDates.includes(d));
  const priorTotals = priorDates.length > 0 ? sanitizeMetrics(aggregatePinterestForRange(priorDates)) : null;

  res.json({ daily, ads, totals, priorTotals, start, end: effectiveEnd });
});

// Targets for the selected month
app.get('/api/targets', (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month.' });
  const t = targetsData.get(month) || null;
  if (t && t.targetSales === 0 && t.targetRoi === 0 && t.targetSpend === 0) return res.json(null);
  res.json(t);
});

// ─── Start ───────────────────────────────────────────────────────────────────

loadData();

const dataDir = path.join(__dirname, 'data');
fs.watch(dataDir, (eventType, filename) => {
  if (filename === 'targets.xlsx') {
    setTimeout(() => {
      console.log('[RELOAD] targets.xlsx updated, reloading targets...');
      parseTargets(path.join(dataDir, 'targets.xlsx'));
    }, 300);
  }
});

app.listen(PORT, () => {
  console.log(`Cocoon Dashboard → http://localhost:${PORT}`);
});
