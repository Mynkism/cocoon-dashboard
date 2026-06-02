# Cocoon Dashboard

Internal marketing analytics dashboard for Cocoon Furniture. Runs locally on Node.js. No cloud, no auth, no deployment.

---

## Who this is for

The Cocoon marketing team. Gives a live view of Meta Ads, Google Ads, Shopify sales, and visitor data in one place — with day-by-day breakdowns, month-on-month comparisons, and platform-level ad performance.

---

## Prerequisites

- Node.js v18 or later
- npm (comes with Node.js)

---

## Setup

1. Place the `cocoon-dashboard` folder anywhere on your laptop.
2. Open a terminal, `cd` into the folder.
3. Run `npm install` (first time only).
4. Drop your four CSV files into the `/data` folder (see **Export Settings** below).
5. Run `node server.js`.
6. Open `http://localhost:3000` in your browser.

---

## Refreshing data

When you have new exports:

1. Replace the files in `/data` with fresh exports (keep the same filenames).
2. Stop the server (`Ctrl+C`).
3. Run `node server.js` again.
4. Refresh the browser.

The dashboard reads everything fresh on each server start. No database. No cache to clear.

---

## Updating Data

Use this workflow when you have incremental exports (last 7–10 days) and want to merge them into the existing history rather than replacing everything.

1. Export fresh CSVs from each platform (last 7–10 days of data is enough — the script handles overlaps automatically).
2. Save them into the `/updates` folder using the **exact same filenames** as the `/data` folder:
   - `shopify_sales.csv`
   - `shopify_visitors.csv`
   - `google_ads.csv`
   - `meta_ads.csv`
3. Run the update script from the project root:
   ```
   node update.js
   ```
4. The script merges the new data into `/data` automatically — overlapping dates are replaced, new dates are appended, and the files are re-sorted chronologically.
5. Restart the server so the dashboard picks up the new data:
   - Stop the current server with `Ctrl+C`
   - Run `node server.js` again
6. The `/updates` folder can be cleared after each successful update — the files there are only needed during the merge.

---

## DATA_CUTOFF_DATE logic

On startup, the server reads the latest date from each of the four CSV files. It then takes the **minimum** of those four dates. That becomes the `DATA_CUTOFF_DATE`.

This ensures the dashboard only shows data where all four sources are in sync. If your Meta export only goes to April 14 but Google goes to April 15, the dashboard caps everything at April 14 — so no metric is ever comparing apples to oranges.

The cutoff date is shown in the footer: `Data current to: DD/MM/YYYY`.

---

## Troubleshooting

**Missing file warning appears in the dashboard**  
One of the four CSV files is missing or couldn't be parsed. Check `/data` and make sure all four files are present and correctly named.

**Numbers look wrong**  
Make sure you exported with the exact column names described in the Export Settings section below. The parser is strict about column headers.

**Port already in use**  
Run `lsof -i :3000` to find what's using port 3000, then kill that process.

---

## Export Settings

### shopify_sales.csv

- **Source**: Shopify Admin → Analytics → Reports → Sales by product
- **Date range**: Full history (from August 2025 onwards)
- **Format**: CSV
- **Save as**: `shopify_sales.csv`

Expected columns: `Day, Product title, Product variant SKU, Month, Net items sold, Gross sales, Discounts, Returns, Net sales, Taxes, Total sales, Orders`

---

### shopify_visitors.csv

- **Source**: Shopify Admin → Analytics → Reports → Visitors over time
- **Date range**: Full history
- **Format**: CSV
- **Save as**: `shopify_visitors.csv`

Expected columns: `Day, Online store visitors, Sessions` (plus any comparison period columns Shopify appends — these are ignored automatically)

---

### google_ads.csv

- **Source**: Google Ads → Reports → Custom report, segmented by Day
- **Columns to include**: Campaign type, Campaign, Day, Currency code, Cost, Clicks, Impr., CTR, Avg. CPC, Conversions, Conv. rate, Conv. value, Cost / conv.
- **Format**: CSV
- **Save as**: `google_ads.csv`

Note: Google prepends two non-data rows (report name + date range) above the column headers. The parser skips these automatically using `from_line: 3`.

---

### meta_ads.csv

- **Source**: Meta Ads Manager → Reports → Export, breakdown by Day
- **Format**: CSV
- **Save as**: `meta_ads.csv`

Expected columns: `Campaign name, Ad set name, Ad name, Day, Delivery status, Delivery level, Result type, Results, Cost per result, Amount spent (AUD), Impressions, Reach, Attribution setting, Quality ranking, Engagement rate ranking, Conversion rate ranking, Ad set name.1, Purchases, Purchases conversion value, Link clicks, Reporting starts, Reporting ends`

Note: Meta exports include a BOM character at the start of the file. The parser handles this automatically.
