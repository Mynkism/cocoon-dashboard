const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA_DIR = path.join(__dirname, 'data');
const UPDATES_DIR = path.join(__dirname, 'updates');
const LOG_FILE = path.join(UPDATES_DIR, 'update-log.txt');

const FILE_CONFIGS = [
  { filename: 'shopify_sales.csv',    dateColumn: 'Day', skipLines: 0, bom: false },
  { filename: 'shopify_visitors.csv', dateColumn: 'Day', skipLines: 0, bom: false, requiredColumns: ['Day', 'Online store visitors', 'Sessions'] },
  { filename: 'google_ads.csv',       dateColumn: 'Day', skipLines: 2, bom: false },
  { filename: 'meta_ads.csv',         dateColumn: 'Day', skipLines: 0, bom: true, requiredColumns: ['Day', 'Campaign name', 'Amount spent (AUD)', 'Impressions', 'Reach', 'Link clicks', 'Purchases', 'Purchases conversion value'] },
];

// Minimal CSV serialiser — quotes any field that contains comma, quote, or newline
function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function serializeCsv(records, headers) {
  if (records.length === 0) return '';
  const cols = headers || Object.keys(records[0]);
  const rows = [cols.map(csvEscape).join(',')];
  for (const rec of records) {
    rows.push(cols.map(h => csvEscape(rec[h])).join(','));
  }
  return rows.join('\n') + '\n';
}

function parseDate(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  return trimmed.slice(0, 10); // keep YYYY-MM-DD
}

function formatDateRange(dates) {
  const sorted = [...dates].sort();
  return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
}

function readCsv(filePath, { skipLines, bom }) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (bom && raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  if (skipLines > 0) {
    const lines = raw.split('\n');
    raw = lines.slice(skipLines).join('\n');
  }
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

function appendLog(lines) {
  fs.appendFileSync(LOG_FILE, lines.join('\n') + '\n', 'utf8');
}

function processFile(config, logLines) {
  const { filename, dateColumn, skipLines, bom, requiredColumns } = config;
  const updatePath = path.join(UPDATES_DIR, filename);
  const dataPath = path.join(DATA_DIR, filename);

  console.log(`Processing ${filename}...`);

  if (!fs.existsSync(updatePath)) {
    const msg = `  ${filename} not found in /updates, skipping.`;
    console.log(msg);
    logLines.push(msg);
    return null;
  }

  // Step 1: Read /data file and take in-memory backup before touching anything
  let dataBackup, existingRecords;
  try {
    dataBackup = fs.readFileSync(dataPath, 'utf8');
    // BUG2: auto-detect skip rows for google_ads /data file (may still have report headers)
    let dataSkipLines = 0;
    if (filename === 'google_ads.csv') {
      const firstLine = dataBackup.split('\n')[0] || '';
      dataSkipLines = firstLine.trim().startsWith('Campaign type') ? 0 : 2;
    }
    // BUG3: pass bom from config so meta_ads /data BOM is stripped on parse
    existingRecords = readCsv(dataPath, { skipLines: dataSkipLines, bom });
  } catch (err) {
    const msg = `  ERROR reading ${filename} from /data: ${err.message}. Skipping.`;
    console.log(msg);
    logLines.push(msg);
    return null;
  }

  // Step 2: Read /updates file (uses file-specific skipLines for google_ads etc.)
  let updateRecords;
  try {
    updateRecords = readCsv(updatePath, { skipLines, bom });
  } catch (err) {
    const msg = `  ERROR reading ${filename} from /updates: ${err.message}. Skipping.`;
    console.log(msg);
    logLines.push(msg);
    return null;
  }

  if (updateRecords.length === 0) {
    const msg = `  ${filename} in /updates is empty or headers only. Skipping.`;
    console.log(msg);
    logLines.push(msg);
    return null;
  }

  // Step 4: Verify columns match before merging; use /data headers as canonical
  const dataColumns = existingRecords.length > 0 ? Object.keys(existingRecords[0]) : [];
  const updateColumns = Object.keys(updateRecords[0]);

  // BUG1: for files with requiredColumns, only verify those columns exist in both files
  // and project records down to those columns only (ignores extra cols in either file)
  if (requiredColumns) {
    const missingInData   = requiredColumns.filter(c => dataColumns.length > 0 && !dataColumns.includes(c));
    const missingInUpdate = requiredColumns.filter(c => !updateColumns.includes(c));
    if (missingInData.length > 0 || missingInUpdate.length > 0) {
      const msg = `  ERROR: Required columns missing in ${filename}. Missing from /data: [${missingInData.join(', ')}] | Missing from /updates: [${missingInUpdate.join(', ')}]. Aborting — nothing written.`;
      console.log(msg);
      logLines.push(msg);
      return null;
    }
    existingRecords = existingRecords.map(r => Object.fromEntries(requiredColumns.map(c => [c, r[c]])));
    updateRecords   = updateRecords.map(r => Object.fromEntries(requiredColumns.map(c => [c, r[c]])));
  } else if (dataColumns.length > 0) {
    const dataCols = dataColumns.map(c => c.trim()).sort().join('|');
    const updCols  = updateColumns.map(c => c.trim()).sort().join('|');
    if (dataCols !== updCols) {
      const msg = `  ERROR: Column mismatch in ${filename}. /data cols: [${dataColumns.join(', ')}] | /updates cols: [${updateColumns.join(', ')}]. Aborting — nothing written.`;
      console.log(msg);
      logLines.push(msg);
      return null;
    }
  }

  // Canonical header order comes from /data (step 5 requirement)
  const canonicalHeaders = requiredColumns || (dataColumns.length > 0 ? dataColumns : updateColumns);

  // Collect unique dates from update file; skip unparseable rows
  const updateDates = new Set();
  const cleanUpdateRecords = [];
  for (let i = 0; i < updateRecords.length; i++) {
    const row = updateRecords[i];
    const parsed = parseDate(row[dateColumn]);
    if (!parsed) {
      const msg = `  WARNING: Could not parse date in row ${i + 1} of ${filename} update file. Row skipped.`;
      console.log(msg);
      logLines.push(msg);
      continue;
    }
    updateDates.add(parsed);
    cleanUpdateRecords.push(row);
  }

  if (updateDates.size === 0) {
    const msg = `  No valid dates found in ${filename} update file. Skipping.`;
    console.log(msg);
    logLines.push(msg);
    return null;
  }

  // Remove existing rows that overlap with the update dates
  const filtered = existingRecords.filter(row => {
    const d = parseDate(row[dateColumn]);
    return d === null || !updateDates.has(d);
  });

  const removedCount = existingRecords.length - filtered.length;

  // Merge and sort chronologically
  const merged = [...filtered, ...cleanUpdateRecords];
  merged.sort((a, b) => {
    const da = (a[dateColumn] || '').trim();
    const db = (b[dateColumn] || '').trim();
    return da.localeCompare(db);
  });

  // Step 5: Write using /data canonical headers so all columns are preserved
  fs.writeFileSync(dataPath, serializeCsv(merged, canonicalHeaders), 'utf8');

  // Step 6: Verify the written file has the correct column count; restore on failure
  try {
    const written = readCsv(dataPath, { skipLines: 0, bom: false });
    if (written.length > 0 && Object.keys(written[0]).length !== canonicalHeaders.length) {
      fs.writeFileSync(dataPath, dataBackup, 'utf8');
      const msg = `  ERROR: Post-write column count mismatch in ${filename} (expected ${canonicalHeaders.length}, got ${Object.keys(written[0]).length}). Restored from backup.`;
      console.log(msg);
      logLines.push(msg);
      return null;
    }
  } catch (err) {
    fs.writeFileSync(dataPath, dataBackup, 'utf8');
    const msg = `  ERROR: Post-write verification failed for ${filename}: ${err.message}. Restored from backup.`;
    console.log(msg);
    logLines.push(msg);
    return null;
  }

  const dateRange = formatDateRange([...updateDates]);
  const lines = [
    `  Dates in update file: ${updateDates.size} (${dateRange})`,
    `  Rows removed from existing data: ${removedCount}`,
    `  Rows added from update: ${cleanUpdateRecords.length}`,
    `  New total rows: ${merged.length}`,
    `  \u2713 Done`,
  ];
  lines.forEach(l => console.log(l));

  return {
    filename,
    dateRange,
    updateDateCount: updateDates.size,
    removedCount,
    addedCount: cleanUpdateRecords.length,
    totalRows: merged.length,
    latestDate: [...updateDates].sort().pop(),
  };
}

function run() {
  if (!fs.existsSync(UPDATES_DIR)) {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    console.log('Created /updates folder. Add your fresh CSV exports here and run node update.js again.');
    return;
  }

  const now = new Date();
  const timestamp = now.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  console.log('============================');
  console.log('COCOON DASHBOARD \u2014 DATA UPDATE');
  console.log('============================');

  const logLines = [`\n===== UPDATE RUN: ${timestamp} =====`];
  const results = [];

  for (const config of FILE_CONFIGS) {
    try {
      const result = processFile(config, logLines);
      if (result) {
        results.push(result);
        logLines.push(
          `${result.filename}: ${result.updateDateCount} dates (${result.dateRange}) | removed ${result.removedCount} | added ${result.addedCount} | total ${result.totalRows}`
        );
      }
    } catch (err) {
      const msg = `  UNEXPECTED ERROR processing ${config.filename}: ${err.message}. Skipping.`;
      console.log(msg);
      logLines.push(msg);
    }
    console.log('');
  }

  const latestDate = results.length
    ? results.map(r => r.latestDate).filter(Boolean).sort().pop()
    : 'unknown';

  console.log('============================');
  console.log('UPDATE COMPLETE');
  console.log(`Data current to: ${latestDate}`);
  console.log(`Log saved to: /updates/update-log.txt`);
  console.log('============================');

  logLines.push(`Data current to: ${latestDate}`);
  logLines.push('');

  appendLog(logLines);
}

run();
