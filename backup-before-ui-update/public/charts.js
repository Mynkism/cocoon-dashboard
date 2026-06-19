'use strict';

// ─── Chart instance registry ─────────────────────────────────────────────────
// All active Chart.js instances keyed by canvas element id.
// Every sparkline and modal chart must be destroyed through this registry
// before re-creation to prevent ghost chart warnings.
const chartInstances = {};

// The single active modal chart (destroyed before each re-open)
let modalChartInstance = null;

// ─── Sparkline creation ──────────────────────────────────────────────────────

/**
 * Create (or replace) a sparkline on a canvas element.
 * Data points that are null create gaps in the line (spanGaps: false).
 * @param {string} canvasId - DOM id of the <canvas>
 * @param {Array<number|null>} dataPoints - y-values; null = no-data gap
 * @param {number} heightPx - canvas height in pixels
 */
function createSparkline(canvasId, dataPoints, heightPx = 36) {
  // Destroy existing instance to avoid duplicate canvas / ghost warnings
  destroyChart(canvasId);

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.height = heightPx;

  const ctx = canvas.getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   dataPoints.map((_, i) => i),
      datasets: [{
        data:          dataPoints,
        borderColor:   getComputedStyle(document.documentElement).getPropertyValue('--sparkline-color').trim(),
        borderWidth:   2,
        pointRadius:   0,
        pointHitRadius: 0,
        spanGaps:      false,
        fill:          false,
        tension:       0.3,
      }],
    },
    options: {
      animation:   false,
      responsive:  true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      elements: { line: { borderCapStyle: 'round' } },
    },
  });
}

// ─── Modal chart creation ─────────────────────────────────────────────────────

/**
 * Create the full interactive chart inside the modal panel.
 * Destroys any previous modal chart instance first.
 * @param {Array<string>} labels  - X-axis date labels formatted as "DD/MM"
 * @param {Array<number|null>} values - Y-axis values; null = gap
 * @param {string} formatType    - one of: currency|integer|multiplier|percent|integer_abbr
 * @param {Function} formatter   - formatNumber(value, type) from app.js
 */
function createModalChart(labels, values, formatType, formatter) {
  // Destroy any previously open modal chart
  if (modalChartInstance) {
    modalChartInstance.destroy();
    modalChartInstance = null;
  }

  const canvas = document.getElementById('modal-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Gradient fill below the line
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0,   'rgba(0, 212, 170, 0.20)');
  grad.addColorStop(1,   'rgba(0, 212, 170, 0)');

  modalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data:          values,
        borderColor:   '#00d4aa',
        borderWidth:   2,
        pointRadius:   0,
        pointHitRadius: 8,
        spanGaps:      false,
        fill:          true,
        backgroundColor: grad,
        tension:       0.3,
      }],
    },
    options: {
      responsive:  true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor:     '#2a2a2a',
          borderWidth:     1,
          bodyColor:       '#f0f0f0',
          titleColor:      '#888888',
          callbacks: {
            // Format tooltip value using the caller-supplied formatter
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v === null ? 'N/A' : formatter(v, formatType);
            },
          },
        },
        // Vertical crosshair line on hover
        crosshair: false,
      },
      scales: {
        x: {
          grid:   { color: '#1a1a1a' },
          ticks:  { color: '#888888', font: { size: 11 }, maxRotation: 0 },
          border: { color: '#2a2a2a' },
        },
        y: {
          grid:   { color: '#1a1a1a' },
          ticks:  {
            color: '#888888',
            font:  { size: 11 },
            callback: (val) => formatter(val, formatType),
          },
          border: { color: '#2a2a2a' },
        },
      },
    },
  });
}

// ─── Instance management ──────────────────────────────────────────────────────

/**
 * Destroy a chart instance by canvas id, removing it from the registry.
 * Safe to call even if no instance exists for that id.
 */
function destroyChart(canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }
}

/**
 * Destroy all sparkline instances in the registry (but not the modal chart).
 * Called when switching months or date ranges to clean up before re-creation.
 */
function destroyAllSparklines() {
  for (const id of Object.keys(chartInstances)) {
    destroyChart(id);
  }
}

/**
 * Destroy the modal chart instance.
 * Called when the modal is closed.
 */
function destroyModalChart() {
  if (modalChartInstance) {
    modalChartInstance.destroy();
    modalChartInstance = null;
  }
}
