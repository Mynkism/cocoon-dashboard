# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (first time only)
npm install

# Start the dashboard
node server.js
# → http://localhost:3000

# Merge incremental CSV exports from /updates into /data
node update.js
```

No build step, no test suite, no lint config.

## Architecture

**Single-process local app.** `server.js` loads all CSV data into in-memory Maps on startup, then serves a static frontend and a JSON REST API. There is no database and no persistent state — restarting the server reloads everything from disk.

### Data flow

```
/data/*.csv + targets.xlsx
       ↓  (parsed once at startup by server.js)
In-memory Maps (shopifySalesData, shopifyVisitorsData, googleDailyData, metaAdsData)
       ↓  (aggregated on each API request)
REST API  →  public/app.js  →  Chart.js charts + DOM tables
```

All four Maps are keyed by `YYYY-MM-DD` string. `DATA_CUTOFF_DATE` is the minimum of each file's latest date, ensuring all metrics are always in sync across sources. All API responses are capped at this date.

### Server (`server.js`)

- **Parsers** (`parseShopifySales`, `parseShopifyVisitors`, `parseGoogleAds`, `parseMetaAds`) — each reads a CSV file and returns `{ data: Map, rowCount, campaignRows? }`. Google Ads auto-detects whether the file has Google's 2-row report header prefix. Meta Ads strips the BOM character.
- **`googleCampaignRows` / `metaCampaignRows`** — raw campaign-level rows kept separately from the day-aggregated Maps, used by the Ads Breakdown tab. Meta breakdown filters to campaigns whose name starts with `"RB"`.
- **`aggregateMetrics(dates)`** — core function; takes a date array and joins all four sources into one metrics object including derived ratios (ROI, ROAS, CTR, CPC, CPM, CVR). Returns `null` for any ratio where denominator is 0.
- **`sanitize(val)`** — called on every outgoing number; converts `NaN`/`Infinity`/`undefined` to `null` so JSON responses never have broken values.
- **`targets.xlsx`** hot-reloads via `fs.watch` — no server restart needed when targets change.

### API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/config` | Dates, available months/weeks, file warnings |
| `GET /api/daily?month=YYYY-MM` | Day-by-day rows for the table |
| `GET /api/summary?month=YYYY-MM` | Monthly totals + sparkline arrays + previous month |
| `GET /api/analysis/mom` | All month-on-month pairs |
| `GET /api/analysis/wow` | Week-on-week pairs (Mon–Sun) |
| `GET /api/analysis/mtd` | Month-to-date vs prior month same days |
| `GET /api/analysis/custom?start=&end=` | Arbitrary date range |
| `GET /api/google?start=&end=` | Google daily series + campaign breakdown |
| `GET /api/meta-ads?start=&end=` | Meta daily series + campaign breakdown |
| `GET /api/targets?month=YYYY-MM` | Monthly targets from targets.xlsx |

### Frontend (`public/`)

- **`app.js`** — all UI logic: tab switching, API fetching, DOM rendering, GSAP animations, chart creation via Chart.js. Single global state object (module-level `let` vars). `METRIC_POLARITY` map drives arrow colour (teal = good, amber = bad) for every metric key.
- **`charts.js`** — Chart.js chart factory functions called by `app.js`.
- No framework, no bundler, no TypeScript.

### Data update script (`update.js`)

Merges incremental exports: reads `/updates/{filename}`, removes overlapping dates from `/data/{filename}`, appends new rows, re-sorts chronologically, writes back. Keeps an in-memory backup and restores it if post-write verification fails. Logs each run to `/updates/update-log.txt`.

## CSV format requirements

Each file must match exact column headers — parsers are strict. Key notes:
- **`google_ads.csv`**: may have 2 Google report header rows above the column headers; both `server.js` and `update.js` auto-detect and skip them.
- **`meta_ads.csv`**: exported with a UTF-8 BOM; both scripts strip it automatically.
- All date columns use `YYYY-MM-DD` format.
- `targets.xlsx` sheet columns: `Month` (YYYY-MM), `Target Sales (AUD)`, `Target ROI (x)`, `Target Spend (AUD)`.
