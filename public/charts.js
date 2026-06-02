'use strict';

// ─── Chart instance registry ─────────────────────────────────────────────────
const chartInstances = {};
let modalChartInstance = null;

// ─── Sparkline creation — with gradient fill ─────────────────────────────────
function createSparkline(canvasId, dataPoints, heightPx = 36) {
  destroyChart(canvasId);

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');

  // Teal gradient fill beneath the line
  const grad = ctx.createLinearGradient(0, 0, 0, heightPx);
  grad.addColorStop(0,   'rgba(0, 212, 170, 0.28)');
  grad.addColorStop(0.5, 'rgba(0, 212, 170, 0.10)');
  grad.addColorStop(1,   'rgba(0, 212, 170, 0)');

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   dataPoints.map((_, i) => i),
      datasets: [{
        data:            dataPoints,
        borderColor:     '#00d4aa',
        borderWidth:     1.5,
        pointRadius:     0,
        pointHitRadius:  0,
        spanGaps:        false,
        fill:            true,
        backgroundColor: grad,
        tension:         0.4,
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

// ─── Modal chart creation — gradient fill + enhanced tooltip ─────────────────
function createModalChart(labels, values, formatType, formatter) {
  if (modalChartInstance) {
    modalChartInstance.destroy();
    modalChartInstance = null;
  }

  const canvas = document.getElementById('modal-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Rich multi-stop gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0,    'rgba(0, 212, 170, 0.30)');
  grad.addColorStop(0.35, 'rgba(0, 212, 170, 0.12)');
  grad.addColorStop(0.7,  'rgba(0, 212, 170, 0.04)');
  grad.addColorStop(1,    'rgba(0, 212, 170, 0)');

  modalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data:                      values,
        borderColor:               '#00d4aa',
        borderWidth:               2,
        pointRadius:               0,
        pointHoverRadius:          5,
        pointHoverBackgroundColor: '#00d4aa',
        pointHoverBorderColor:     '#000',
        pointHoverBorderWidth:     2,
        spanGaps:                  false,
        fill:                      true,
        backgroundColor:           grad,
        tension:                   0.4,
      }],
    },
    options: {
      responsive:  true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(16, 16, 16, 0.96)',
          borderColor:     'rgba(0, 212, 170, 0.25)',
          borderWidth:     1,
          bodyColor:       '#f0f0f0',
          titleColor:      '#00d4aa',
          titleFont:       { family: 'JetBrains Mono', size: 11 },
          bodyFont:        { family: 'JetBrains Mono', size: 13, weight: '700' },
          padding:         10,
          cornerRadius:    6,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v === null ? 'N/A' : ' ' + formatter(v, formatType);
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks:  { color: '#555', font: { size: 10, family: 'JetBrains Mono' }, maxRotation: 0 },
          border: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          grid:   { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks:  {
            color: '#555',
            font:  { size: 10, family: 'JetBrains Mono' },
            callback: (val) => formatter(val, formatType),
          },
          border: { color: 'rgba(255,255,255,0.06)' },
        },
      },
    },
  });
}

// ─── Target donut chart ───────────────────────────────────────────────────────
function createDonutChart(canvasId, percent, overTarget, polarity) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const filled    = Math.min(percent, 1);
  const remaining = 1 - filled;

  let fillColor = '#00d4aa';
  if (polarity === 'lower_is_better' && overTarget) fillColor = '#f59e0b';

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data:            [filled, remaining],
        backgroundColor: [fillColor, '#1a1a1a'],
        borderWidth:     0,
        borderRadius:    filled > 0 && filled < 1 ? 3 : 0,
      }],
    },
    options: {
      cutout: '72%',
      rotation: -90,
      animation: { animateRotate: true, duration: 800, easing: 'easeInOutQuart' },
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
    },
  });
}

// ─── Instance management ──────────────────────────────────────────────────────
function destroyChart(canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }
}

function destroyAllSparklines() {
  for (const id of Object.keys(chartInstances)) {
    destroyChart(id);
  }
}

function destroyModalChart() {
  if (modalChartInstance) {
    modalChartInstance.destroy();
    modalChartInstance = null;
  }
}
