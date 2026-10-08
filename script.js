const HEADINGS = ['Date', 'Description', 'Category', 'Amount', 'Type', 'Method'];
const TYPE_OPTIONS = ['Debit', 'Credit'];
const METHOD_OPTIONS = ['UPI', 'Cash', 'Card'];
const CURRENCY = '₹';
const DAY_MS = 86400000;
const moneyFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const openCsvButton = document.querySelector('#open-csv');
const editCsvButton = document.querySelector('#edit-csv');
const exportCsvButton = document.querySelector('#export-csv');
const csvFileInput = document.querySelector('#csv-file');
const tablePanel = document.querySelector('#table-panel');
const csvTable = document.querySelector('#csv-table');
const tableStatus = document.querySelector('#table-status');
const categoryOptions = document.querySelector('#category-options');
const addRowButton = document.querySelector('#add-row');
const deleteRowButton = document.querySelector('#delete-row');
const errorCountLabel = document.querySelector('#error-count');
const chartArea = document.querySelector('#chart-area');
const chartCanvas = document.querySelector('#savings-chart');
const chartEmpty = document.querySelector('#chart-empty');
const chartReadout = document.querySelector('#chart-readout');
const statsCaption = document.querySelector('#stats-caption');
const analyticsNote = document.querySelector('#analytics-note');
const metricSelect = document.querySelector('#metric-select');
const categorySelect = document.querySelector('#category-select');
const methodSelect = document.querySelector('#method-select');
const valueModeSelect = document.querySelector('#value-mode-select');
const intervalControl = document.querySelector('#interval-control');
const intervalButtons = [...intervalControl.querySelectorAll('[data-interval]')];
let csvRows = [];
let isEditing = false;
let hasCsv = false;
let selectedRowIndex = null;
let interval = '1D';
let metric = 'rate';
let valueMode = 'cumulative';
let selectedCategory = '';
let selectedMethod = '';
let analyticsTimer = null;
let analyticsState = { rows: [], candles: [], skipped: 0 };
let chartView = { startMs: null, pixelsPerDay: 1 };
let chartHoverIndex = null;
let chartPointer = null;
let chartDrag = null;
let chartFrame = null;

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === ',' && !insideQuotes) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function normaliseHeading(value) {
  return value.trim().toLowerCase();
}

function hasValidHeadings(rows) {
  return rows.length > 0 && rows[0].length === HEADINGS.length
    && rows[0].every((value, index) => normaliseHeading(value) === normaliseHeading(HEADINGS[index]));
}

function normaliseOption(options, value) {
  const trimmedValue = value.trim();
  return options.find((option) => option.toLowerCase() === trimmedValue.toLowerCase()) || trimmedValue;
}

function isValidDate(value) {
  const dateValue = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false;
  const date = new Date(`${dateValue}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === dateValue;
}

function parseDateValue(value) {
  return new Date(`${value.trim()}T00:00:00Z`);
}

function getAnalyticsRows() {
  const validRows = [];
  let skipped = 0;
  csvRows.forEach((row, sourceIndex) => {
    const amountText = row[3].trim();
    const amount = Number(amountText);
    const valid = /^-?\d+(\.\d{1,2})?$/.test(amountText)
      && Number.isFinite(amount)
      && TYPE_OPTIONS.includes(row[4])
      && METHOD_OPTIONS.includes(row[5]);
    if (!valid) {
      skipped += 1;
      return;
    }
    validRows.push({
      date: isValidDate(row[0]) ? row[0].trim() : 'Unknown date',
      dateValue: isValidDate(row[0]) ? parseDateValue(row[0]) : null,
      description: row[1],
      category: row[2].trim() || 'Uncategorised',
      amountPaise: Math.round(Math.abs(amount) * 100),
      type: row[4],
      method: row[5],
      sourceIndex
    });
  });
  validRows.sort((leftRow, rightRow) => (leftRow.dateValue || new Date(0)) - (rightRow.dateValue || new Date(0)) || leftRow.sourceIndex - rightRow.sourceIndex);
  return { rows: validRows, skipped };
}

function applyFilters(rows) {
  return rows.filter((row) => (!selectedCategory || row.category === selectedCategory)
    && (!selectedMethod || row.method === selectedMethod));
}

function getBucket(dateValue, selectedInterval) {
  const year = dateValue.getUTCFullYear();
  const month = dateValue.getUTCMonth();
  const day = dateValue.getUTCDate();
  if (selectedInterval === '1Y') {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    return { key: `${year}`, start, end, days: (end - start) / DAY_MS };
  }
  if (selectedInterval === '1M') {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    return { key: `${year}-${month}`, start, end, days: (end - start) / DAY_MS };
  }
  if (selectedInterval === '1W') {
    const mondayOffset = (dateValue.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(year, month, day - mondayOffset));
    const end = new Date(start.getTime() + 7 * DAY_MS);
    return { key: start.toISOString().slice(0, 10), start, end, days: 7 };
  }
  const start = new Date(Date.UTC(year, month, day));
  return { key: start.toISOString().slice(0, 10), start, end: new Date(start.getTime() + DAY_MS), days: 1 };
}

function buildCandles(rows) {
  const buckets = new Map();
  let creditPaise = 0;
  let debitPaise = 0;
  const timelineStart = rows.find((row) => row.dateValue)?.dateValue || new Date();
  rows.forEach((row) => {
    if (row.type === 'Credit') creditPaise += row.amountPaise;
    else debitPaise += row.amountPaise;
    const bucket = row.dateValue ? getBucket(row.dateValue, interval) : getBucket(timelineStart, interval);
    let entry = buckets.get(bucket.key);
    if (!entry) {
      entry = { ...bucket, values: [], creditPaise: 0, debitPaise: 0 };
      buckets.set(bucket.key, entry);
    }
    if (row.type === 'Credit') entry.creditPaise += row.amountPaise;
    else entry.debitPaise += row.amountPaise;
    const savingsPaise = creditPaise - debitPaise;
    // Always push the real running metric value here. (Previously this hard-coded 0
    // for rows with an unknown/missing date, even though creditPaise/debitPaise above
    // were still updated for them — that mismatch could corrupt a bucket's high/low/close
    // with a bogus zero in cumulative mode.)
    entry.values.push(metric === 'credit' ? creditPaise : metric === 'debit' ? debitPaise : metric === 'savings' ? savingsPaise : (creditPaise ? (savingsPaise / creditPaise) * 100 : 0));
  });
  let previousClose = null;
  return [...buckets.values()].map((bucket) => {
    const linearValue = metric === 'credit'
      ? bucket.creditPaise
      : metric === 'debit'
        ? bucket.debitPaise
        : metric === 'savings'
          ? bucket.creditPaise - bucket.debitPaise
          : bucket.creditPaise === 0
            ? 0
            : ((bucket.creditPaise - bucket.debitPaise) / bucket.creditPaise) * 100;
    const values = valueMode === 'linear' ? [linearValue] : bucket.values;
    if (values.length === 0) return null;
    const open = previousClose === null ? values[0] : previousClose;
    const close = values[values.length - 1];
    const high = Math.max(open, ...values);
    const low = Math.min(open, ...values);
    previousClose = close;
    return {
      ...bucket,
      open,
      high,
      low,
      close,
      periodCreditPaise: bucket.creditPaise,
      periodDebitPaise: bucket.debitPaise
    };
  }).filter(Boolean);
}

function formatMoney(amountPaise) {
  return `${CURRENCY}${moneyFormatter.format(amountPaise / 100)}`;
}

function updateStats(rows, skipped) {
  if (!hasCsv) {
    ['stat-rate', 'stat-savings', 'stat-credit', 'stat-debit'].forEach((id) => {
      document.querySelector(`#${id}`).textContent = '—';
    });
    statsCaption.textContent = '—';
    analyticsNote.textContent = '';
    return;
  }
  let creditPaise = 0;
  let debitPaise = 0;
  rows.forEach((row) => {
    if (row.type === 'Credit') creditPaise += row.amountPaise;
    else debitPaise += row.amountPaise;
  });
  const savingsPaise = creditPaise - debitPaise;
  const rate = creditPaise === 0 ? null : (savingsPaise / creditPaise) * 100;
  const values = {
    'stat-rate': rate === null ? '—' : `${rate.toFixed(1)}%`,
    'stat-savings': formatMoney(savingsPaise),
    'stat-credit': formatMoney(creditPaise),
    'stat-debit': formatMoney(debitPaise)
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.querySelector(`#${id}`);
    element.textContent = value;
    // Only the rate and the net savings figure have a meaningful "good/bad" sign.
    // Total Credit and Total Debit are magnitudes, not outcomes, so they should
    // not be tinted green/red based on the overall savings sign.
    if (id === 'stat-rate' || id === 'stat-savings') {
      const signedValue = id === 'stat-rate' ? rate : savingsPaise;
      element.classList.toggle('positive', signedValue > 0);
      element.classList.toggle('negative', signedValue < 0);
    } else {
      element.classList.remove('positive', 'negative');
    }
  });
  const firstDate = rows[0]?.date || '—';
  const lastDate = rows[rows.length - 1]?.date || '—';
  statsCaption.textContent = `${rows.length} transaction${rows.length === 1 ? '' : 's'}, ${firstDate} to ${lastDate}`;
  analyticsNote.textContent = skipped ? `${skipped} row${skipped === 1 ? '' : 's'} skipped (invalid)` : '';
}

function renderFilters(analyticsRows) {
  const categories = [...new Set(analyticsRows.map((row) => row.category))].sort();
  const fill = (select, values, placeholder) => {
    const current = select.value;
    const resolved = values.includes(current) ? current : '';
    select.replaceChildren(new Option(placeholder, ''), ...values.map((value) => new Option(value, value)));
    select.value = resolved;
    return resolved;
  };
  // Keep the filter state variables in sync with what the dropdowns actually show.
  // If the previously selected category/method no longer exists in the data,
  // fill() resets the <select> to "All ..." — selectedCategory/selectedMethod must
  // be reset the same way, or the UI would silently keep filtering on a value that
  // can never match any row again.
  selectedCategory = fill(categorySelect, categories, 'All categories');
  selectedMethod = fill(methodSelect, METHOD_OPTIONS, 'All methods');
}

function getChartMetrics() {
  const rect = chartArea.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    left: 56,
    right: 14,
    top: 18,
    bottom: 34
  };
}

function resetChartView(candles = analyticsState.candles) {
  if (!candles.length) {
    chartView = { startMs: null, pixelsPerDay: 1 };
    return;
  }
  chartView.startMs = candles[0].start.getTime();
  chartView.pixelsPerDay = 0;
}

function getNiceStep(range, targetTicks = 5) {
  const rough = range / targetTicks;
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const fraction = rough / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

function formatDateLabel(dateValue, includeYear = false) {
  const options = { day: '2-digit', month: 'short', timeZone: 'UTC' };
  if (includeYear) options.year = 'numeric';
  return new Intl.DateTimeFormat('en-GB', options).format(dateValue);
}

function formatCandleDate(candle) {
  if (interval === '1Y') return String(candle.start.getUTCFullYear());
  if (interval === '1M') return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(candle.start);
  if (interval === '1W') return `${formatDateLabel(candle.start)}–${formatDateLabel(new Date(candle.end.getTime() - DAY_MS))}`;
  return formatDateLabel(candle.start, true);
}

function formatRate(value) {
  return `${value.toFixed(1)}%`;
}

function formatMetric(value) {
  return metric === 'rate' ? formatRate(value) : formatMoney(Math.round(value));
}

function updateChartReadout(candle) {
  const statRateElement = document.querySelector('#stat-rate');
  if (!candle) {
    chartReadout.textContent = '—';
    statRateElement.textContent = '—';
    statRateElement.classList.remove('positive', 'negative');
    return;
  }
  const pointValue = formatMetric(candle.close);
  chartReadout.textContent = `${formatCandleDate(candle)} · ${pointValue} · +${formatMoney(candle.periodCreditPaise)} / −${formatMoney(candle.periodDebitPaise)}`;
  statRateElement.textContent = pointValue;
  // Match the "Point value" card's colour to what it is actually showing right now,
  // rather than leaving it tinted by whatever the overall savings sign was.
  if (metric === 'rate' || metric === 'savings') {
    statRateElement.classList.toggle('positive', candle.close > 0);
    statRateElement.classList.toggle('negative', candle.close < 0);
  } else {
    statRateElement.classList.remove('positive', 'negative');
  }
}

function drawChart() {
  const context = chartCanvas.getContext('2d');
  const metrics = getChartMetrics();
  const pixelRatio = window.devicePixelRatio || 1;
  const canvasWidth = Math.max(1, Math.floor(metrics.width * pixelRatio));
  const canvasHeight = Math.max(1, Math.floor(metrics.height * pixelRatio));
  if (chartCanvas.width !== canvasWidth || chartCanvas.height !== canvasHeight) {
    chartCanvas.width = canvasWidth;
    chartCanvas.height = canvasHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, metrics.width, metrics.height);
  const candles = analyticsState.candles;
  const plotWidth = Math.max(1, metrics.width - metrics.left - metrics.right);
  const plotHeight = Math.max(1, metrics.height - metrics.top - metrics.bottom);
  chartEmpty.hidden = hasCsv && analyticsState.rows.length > 0 && candles.length > 0;
  if (!hasCsv) chartEmpty.textContent = 'Open a CSV to see analytics';
  else if (!analyticsState.rows.length || !candles.length) chartEmpty.textContent = 'No data for the current filters';
  if (!candles.length) {
    updateChartReadout(null);
    return;
  }
  const dataStart = candles[0].start.getTime();
  const dataEnd = candles[candles.length - 1].end.getTime();
  const totalDays = Math.max(1, (dataEnd - dataStart) / DAY_MS);
  const minimumPixelsPerDay = interval === '1D' ? 11 : Math.min(60, plotWidth / totalDays);
  if (!chartView.startMs || !chartView.pixelsPerDay) {
    chartView.startMs = dataStart;
    chartView.pixelsPerDay = minimumPixelsPerDay;
  }
  chartView.pixelsPerDay = Math.max(minimumPixelsPerDay, Math.min(60, chartView.pixelsPerDay));
  const visibleDays = plotWidth / chartView.pixelsPerDay;
  const maxStart = dataEnd - visibleDays * DAY_MS;
  chartView.startMs = Math.max(dataStart, Math.min(chartView.startMs, Math.max(dataStart, maxStart)));
  const visibleCandles = candles.filter((candle) => candle.end.getTime() >= chartView.startMs
    && candle.start.getTime() <= chartView.startMs + visibleDays * DAY_MS);
  const values = visibleCandles.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]);
  let minValue = Math.min(0, ...values);
  let maxValue = Math.max(0, ...values);
  const valueRange = maxValue - minValue || 10;
  minValue -= valueRange * 0.1;
  maxValue += valueRange * 0.1;
  const valueToY = (value) => metrics.top + ((maxValue - value) / (maxValue - minValue)) * plotHeight;
  const xFor = (dateValue) => metrics.left + ((dateValue.getTime() - chartView.startMs) / DAY_MS) * chartView.pixelsPerDay;

  context.font = '11px Inter, sans-serif';
  context.textBaseline = 'middle';
  const tickStep = getNiceStep(maxValue - minValue);
  const firstTick = Math.ceil(minValue / tickStep) * tickStep;
  for (let tick = firstTick; tick <= maxValue + tickStep * 0.01; tick += tickStep) {
    const y = valueToY(tick);
    context.beginPath();
    context.setLineDash(tick === 0 ? [5, 4] : []);
    context.strokeStyle = '#4d4c4c';
    context.moveTo(metrics.left, y);
    context.lineTo(metrics.width - metrics.right, y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#a8a8a8';
    context.textAlign = 'right';
    context.fillText(formatMetric(tick), metrics.left - 8, y);
  }
  context.save();
  context.beginPath();
  context.rect(metrics.left, metrics.top, plotWidth, plotHeight);
  context.clip();
  visibleCandles.forEach((candle, index) => {
    const x = xFor(candle.start);
    const width = Math.max(1, candle.days * chartView.pixelsPerDay * 0.7);
    const center = x + width / 2;
    const isUp = candle.close >= candle.open;
    context.strokeStyle = isUp ? '#facc15' : '#a8a8a8';
    context.fillStyle = isUp ? '#facc15' : '#a8a8a8';
    context.lineWidth = candle === chartHoverIndex ? 2 : 1;
    context.beginPath();
    context.moveTo(center, valueToY(candle.high));
    context.lineTo(center, valueToY(candle.low));
    context.stroke();
    const bodyTop = Math.min(valueToY(candle.open), valueToY(candle.close));
    const bodyHeight = Math.max(1, Math.abs(valueToY(candle.open) - valueToY(candle.close)));
    context.fillRect(x, bodyTop, width, bodyHeight);
    if (candle === chartHoverIndex) {
      context.strokeStyle = '#e5e5e5';
      context.strokeRect(x, bodyTop, Math.max(1, width), bodyHeight);
    }
  });
  if (chartPointer && chartHoverIndex) {
    const candle = chartHoverIndex;
    if (candle) {
      const x = xFor(candle.start) + Math.max(1, candle.days * chartView.pixelsPerDay * 0.7) / 2;
      context.strokeStyle = 'rgba(229, 229, 229, 0.45)';
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(x, metrics.top);
      context.lineTo(x, metrics.top + plotHeight);
      context.stroke();
      context.setLineDash([]);
    }
  }
  context.restore();
  context.fillStyle = '#a8a8a8';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  let previousLabelX = -Infinity;
  visibleCandles.forEach((candle) => {
    const x = xFor(candle.start) + Math.max(1, candle.days * chartView.pixelsPerDay * 0.7) / 2;
    const yearChanged = interval === '1D' && (candle.start.getUTCFullYear() !== visibleCandles[0].start.getUTCFullYear());
    const label = interval === '1D' ? formatDateLabel(candle.start, yearChanged) : formatCandleDate(candle).split('–')[0];
    if (x - previousLabelX < 58) return;
    context.fillText(label, x, metrics.top + plotHeight + 10);
    previousLabelX = x;
  });
  const latest = chartHoverIndex || candles[candles.length - 1];
  updateChartReadout(latest);
  chartCanvas.setAttribute('aria-label', `${interval} ${metric} chart with ${candles.length} points, latest value ${formatMetric(latest.close)}`);
}

function scheduleChartDraw() {
  if (chartFrame) cancelAnimationFrame(chartFrame);
  chartFrame = requestAnimationFrame(() => {
    chartFrame = null;
    drawChart();
  });
}

function setAnalyticsControlsEnabled(enabled) {
  intervalButtons.forEach((button) => {
    button.disabled = !enabled;
  });
  metricSelect.disabled = !enabled;
  categorySelect.disabled = !enabled;
  methodSelect.disabled = !enabled;
}

function resetAnalyticsFilters() {
  interval = '1D';
  metric = 'rate';
  valueMode = 'cumulative';
  selectedCategory = '';
  selectedMethod = '';
  metricSelect.value = metric;
  valueModeSelect.value = valueMode;
  categorySelect.value = selectedCategory;
  methodSelect.value = selectedMethod;
  intervalButtons.forEach((button) => {
    const isActive = button.dataset.interval === interval;
    button.setAttribute('aria-checked', String(isActive));
  });
  resetChartView([]);
}

function updateAnalytics(dataChanged = false, resetZoom = false) {
  const source = getAnalyticsRows();
  if (dataChanged) renderFilters(source.rows);
  analyticsState.rows = applyFilters(source.rows);
  analyticsState.skipped = source.skipped;
  analyticsState.candles = buildCandles(analyticsState.rows);
  if (resetZoom) resetChartView(analyticsState.candles);
  updateStats(analyticsState.rows, source.skipped);
  setAnalyticsControlsEnabled(hasCsv);
  scheduleChartDraw();
}

function scheduleAnalytics(dataChanged = false, resetZoom = false) {
  if (analyticsTimer) clearTimeout(analyticsTimer);
  analyticsTimer = setTimeout(() => {
    analyticsTimer = null;
    updateAnalytics(dataChanged, resetZoom);
  }, 200);
}


function getCandleAtPointer(clientX) {
  const rect = chartCanvas.getBoundingClientRect();
  const metrics = getChartMetrics();
  const x = clientX - rect.left;
  const candles = analyticsState.candles;
  if (!candles.length || chartView.startMs === null) return null;
  let closest = null;
  let closestDistance = Infinity;
  candles.forEach((candle) => {
    const candleX = metrics.left + ((candle.start.getTime() - chartView.startMs) / DAY_MS) * chartView.pixelsPerDay;
    const center = candleX + Math.max(1, candle.days * chartView.pixelsPerDay * 0.7) / 2;
    const distance = Math.abs(center - x);
    if (distance < closestDistance && center >= metrics.left && center <= metrics.width - metrics.right) {
      closest = candle;
      closestDistance = distance;
    }
  });
  return closest;
}

function clampChartView() {
  if (!analyticsState.candles.length) return;
  const metrics = getChartMetrics();
  const plotWidth = Math.max(1, metrics.width - metrics.left - metrics.right);
  const dataStart = analyticsState.candles[0].start.getTime();
  const dataEnd = analyticsState.candles[analyticsState.candles.length - 1].end.getTime();
  const totalDays = Math.max(1, (dataEnd - dataStart) / DAY_MS);
  const minimumPixelsPerDay = interval === '1D' ? 11 : Math.min(60, plotWidth / totalDays);
  chartView.pixelsPerDay = Math.max(minimumPixelsPerDay, Math.min(60, chartView.pixelsPerDay));
  const visibleDays = plotWidth / chartView.pixelsPerDay;
  const maxStart = dataEnd - visibleDays * DAY_MS;
  chartView.startMs = Math.max(dataStart, Math.min(chartView.startMs, Math.max(dataStart, maxStart)));
}

intervalButtons.forEach((button, index) => {
  button.addEventListener('click', () => {
    interval = button.dataset.interval;
    intervalButtons.forEach((item) => item.setAttribute('aria-checked', String(item === button)));
    resetChartView();
    scheduleAnalytics(false, true);
  });
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const targetIndex = (index + direction + intervalButtons.length) % intervalButtons.length;
    intervalButtons[targetIndex].focus();
    intervalButtons[targetIndex].click();
  });
});

metricSelect.addEventListener('change', () => {
  metric = metricSelect.value;
  resetChartView();
  scheduleAnalytics(false, true);
});

valueModeSelect.addEventListener('change', () => {
  valueMode = valueModeSelect.value;
  resetChartView();
  scheduleAnalytics(false, true);
});

categorySelect.addEventListener('change', () => {
  selectedCategory = categorySelect.value;
  resetChartView();
  scheduleAnalytics(false, true);
});

methodSelect.addEventListener('change', () => {
  selectedMethod = methodSelect.value;
  resetChartView();
  scheduleAnalytics(false, true);
});

window.addEventListener('resize', () => {
  scheduleChartDraw();
});

chartCanvas.addEventListener('pointerdown', (event) => {
  if (!analyticsState.candles.length) return;
  chartCanvas.setPointerCapture(event.pointerId);
  chartDrag = { startX: event.clientX, startMs: chartView.startMs };
});

chartCanvas.addEventListener('pointermove', (event) => {
  if (!analyticsState.candles.length) return;
  const rect = chartCanvas.getBoundingClientRect();
  chartPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (chartDrag) {
    chartView.startMs = chartDrag.startMs - (event.clientX - chartDrag.startX) / chartView.pixelsPerDay * DAY_MS;
    clampChartView();
  }
  chartHoverIndex = getCandleAtPointer(event.clientX);
  scheduleChartDraw();
});

chartCanvas.addEventListener('pointerup', (event) => {
  chartDrag = null;
  chartCanvas.releasePointerCapture(event.pointerId);
});

chartCanvas.addEventListener('pointerleave', () => {
  if (!chartDrag) {
    chartPointer = null;
    chartHoverIndex = null;
    scheduleChartDraw();
  }
});

chartCanvas.addEventListener('dblclick', () => {
  resetChartView();
  scheduleChartDraw();
});

const chartResizeObserver = new ResizeObserver(() => scheduleChartDraw());
chartResizeObserver.observe(chartArea);

function getRowErrors(rowIndex) {
  const row = csvRows[rowIndex];
  const errors = new Set();
  if (!isValidDate(row[0])) errors.add(0);
  if (!/^-?\d+(\.\d{1,2})?$/.test(row[3].trim())) errors.add(3);
  if (!TYPE_OPTIONS.includes(row[4])) errors.add(4);
  if (!METHOD_OPTIONS.includes(row[5])) errors.add(5);
  if (rowIndex > 0 && isValidDate(row[0]) && isValidDate(csvRows[rowIndex - 1][0])
    && row[0] < csvRows[rowIndex - 1][0]) {
    errors.add(0);
    errors.add('previous-date');
  }
  return errors;
}

function validateRows() {
  const rowErrors = csvRows.map((row, rowIndex) => getRowErrors(rowIndex));
  const invalidCells = new Set();
  rowErrors.forEach((errors, rowIndex) => {
    errors.forEach((error) => {
      if (typeof error === 'number') invalidCells.add(`${rowIndex}:${error}`);
    });
    if (errors.has('previous-date')) invalidCells.add(`${rowIndex - 1}:0`);
  });
  const tableRows = csvTable.tBodies[0]?.rows || [];
  rowErrors.forEach((errors, rowIndex) => {
    const tableRow = tableRows[rowIndex];
    if (!tableRow) return;
    tableRow.querySelectorAll('td[data-column]').forEach((cell) => {
      const cellKey = `${rowIndex}:${cell.dataset.column}`;
      const isInvalid = invalidCells.has(cellKey);
      const control = cell.querySelector('[data-column]');
      cell.classList.toggle('invalid', isInvalid);
      cell.title = isInvalid && errors.has('previous-date') ? 'Dates must not go backwards' : (isInvalid ? 'Invalid value' : '');
      if (control) {
        if (isInvalid) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    });
  });
  const errorCount = invalidCells.size;
  errorCountLabel.textContent = `Errors: ${errorCount}`;
  errorCountLabel.classList.toggle('has-errors', errorCount > 0);
  tablePanel.classList.toggle('has-errors', errorCount > 0);
  return errorCount === 0;
}

function sortRowsByDate() {
  const selectedRow = selectedRowIndex === null ? null : csvRows[selectedRowIndex];
  csvRows.sort((leftRow, rightRow) => {
    const leftDateValid = isValidDate(leftRow[0]);
    const rightDateValid = isValidDate(rightRow[0]);
    if (!leftDateValid && !rightDateValid) return 0;
    if (!leftDateValid) return 1;
    if (!rightDateValid) return -1;
    return leftRow[0].localeCompare(rightRow[0]);
  });
  if (selectedRow) selectedRowIndex = csvRows.indexOf(selectedRow);
}

function focusFirstError() {
  const firstError = csvTable.querySelector('td.invalid input, td.invalid select');
  if (!firstError) return;
  firstError.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  firstError.focus();
}

function createSelect(options, value, rowIndex, columnIndex) {
  const select = document.createElement('select');
  select.dataset.row = rowIndex;
  select.dataset.column = columnIndex;
  select.setAttribute('aria-label', `Row ${rowIndex + 1}, ${HEADINGS[columnIndex]}`);
  if (!value) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select...';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
  }
  if (value && !options.includes(value)) {
    const invalidOption = document.createElement('option');
    invalidOption.value = value;
    invalidOption.textContent = value;
    invalidOption.selected = true;
    select.append(invalidOption);
  }
  options.forEach((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option;
    optionElement.textContent = option;
    optionElement.selected = option === value;
    select.append(optionElement);
  });
  select.disabled = !isEditing;
  return select;
}

function createInput(value, rowIndex, columnIndex, type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.dataset.row = rowIndex;
  input.dataset.column = columnIndex;
  input.setAttribute('aria-label', `Row ${rowIndex + 1}, ${HEADINGS[columnIndex]}`);
  if (columnIndex === 0) input.placeholder = 'yyyy-mm-dd';
  if (columnIndex === 2) input.setAttribute('list', 'category-options');
  input.disabled = !isEditing;
  return input;
}

function updateCategoryOptions() {
  const categories = [...new Set(csvRows.map((row) => row[2]).filter(Boolean))].sort();
  categoryOptions.replaceChildren(...categories.map((category) => {
    const option = document.createElement('option');
    option.value = category;
    return option;
  }));
}

function renderTable() {
  updateCategoryOptions();
  csvTable.replaceChildren();
  const headerRow = document.createElement('tr');
  HEADINGS.forEach((heading) => {
    const cell = document.createElement('th');
    cell.textContent = heading;
    headerRow.append(cell);
  });
  const header = document.createElement('thead');
  header.append(headerRow);
  csvTable.append(header);

  const body = document.createElement('tbody');
  csvRows.forEach((row, rowIndex) => {
    const tableRow = document.createElement('tr');
    tableRow.dataset.row = rowIndex;
    const cells = [
      // Plain text input (not type="date"): a native date picker silently blanks
      // out any value that isn't already a valid ISO date, which hides exactly the
      // malformed CSV dates this app is meant to surface and let the user fix.
      createInput(row[0], rowIndex, 0),
      createInput(row[1], rowIndex, 1),
      createInput(row[2], rowIndex, 2),
      createInput(row[3], rowIndex, 3),
      createSelect(TYPE_OPTIONS, row[4], rowIndex, 4),
      createSelect(METHOD_OPTIONS, row[5], rowIndex, 5)
    ];
    cells.forEach((control) => {
      const cell = document.createElement('td');
      cell.dataset.column = control.dataset.column;
      cell.append(control);
      tableRow.append(cell);
    });
    tableRow.classList.toggle('selected', isEditing && rowIndex === selectedRowIndex);
    body.append(tableRow);
  });
  csvTable.append(body);
  validateRows();
}

function setStatus(message, isError = false) {
  tableStatus.textContent = message;
  tableStatus.classList.toggle('error', isError);
}

function updateButtonState() {
  editCsvButton.disabled = !hasCsv;
  exportCsvButton.disabled = !hasCsv || csvRows.length === 0;
  addRowButton.disabled = !isEditing;
  deleteRowButton.disabled = !isEditing || selectedRowIndex === null || csvRows.length === 0;
  editCsvButton.textContent = isEditing ? 'Save Edits' : 'Edit CSV';
  tablePanel.classList.toggle('is-editing', isEditing);
}

async function openFile(file) {
  if (!file) return;
  const rows = parseCsv(await file.text());
  if (!hasValidHeadings(rows)) {
    setStatus('Invalid CSV: headings must be Date, Description, Category, Amount, Type, Method in that order.', true);
    return;
  }
  const hasExtraColumns = rows.slice(1).some((row) => row.length > HEADINGS.length);
  csvRows = rows.slice(1).map((row) => HEADINGS.map((_, index) => {
    const value = (row[index] || '').trim();
    if (index === 4) return normaliseOption(TYPE_OPTIONS, value);
    if (index === 5) return normaliseOption(METHOD_OPTIONS, value);
    return value;
  }));
  hasCsv = true;
  selectedRowIndex = null;
  isEditing = false;
  // Sort chronologically right away. Without this, any CSV whose rows weren't
  // already in date order would show spurious "dates go backwards" validation
  // errors on every row pair out of order, blocking export of otherwise-valid data.
  sortRowsByDate();
  resetAnalyticsFilters();
  updateButtonState();
  renderTable();
  const loadMessage = csvRows.length ? 'CSV loaded. Invalid values are highlighted.' : 'Empty CSV loaded. Add rows in edit mode.';
  setStatus(hasExtraColumns ? `${loadMessage} Some rows had extra columns that were ignored.` : loadMessage);
  scheduleAnalytics(true, true);
}

function addRow(rowIndex) {
  csvRows.splice(rowIndex, 0, ['', '', '', '', 'Debit', 'UPI']);
  selectedRowIndex = rowIndex;
  renderTable();
  updateButtonState();
  const dateInput = csvTable.querySelector(`tr[data-row="${rowIndex}"] input[data-column="0"]`);
  if (dateInput) {
    dateInput.focus({ preventScroll: true });
    dateInput.scrollIntoView({ block: 'nearest' });
  }
  scheduleAnalytics(true);
}

addRowButton.addEventListener('click', () => {
  const rowIndex = selectedRowIndex === null ? csvRows.length : selectedRowIndex + 1;
  addRow(rowIndex);
});

openCsvButton.addEventListener('click', () => csvFileInput.click());
csvFileInput.addEventListener('change', async () => {
  await openFile(csvFileInput.files[0]);
  csvFileInput.value = '';
});

editCsvButton.addEventListener('click', () => {
  if (isEditing) {
    const isValid = validateRows();
    isEditing = false;
    selectedRowIndex = null;
    setStatus(isValid ? 'Edits saved. No errors found.' : 'Edits saved with errors. Invalid cells remain highlighted.', !isValid);
  } else {
    isEditing = true;
    setStatus('Edit values, then select a row to delete it.');
  }
  updateButtonState();
  renderTable();
  scheduleAnalytics(true);
});

csvTable.addEventListener('input', (event) => {
  const control = event.target.closest('[data-column]');
  if (!control) return;
  csvRows[Number(control.dataset.row)][Number(control.dataset.column)] = control.value;
  validateRows();
  scheduleAnalytics(true);
});

csvTable.addEventListener('change', (event) => {
  const control = event.target.closest('[data-column]');
  if (!control) return;
  csvRows[Number(control.dataset.row)][Number(control.dataset.column)] = control.value;
  if (Number(control.dataset.column) === 0 && isValidDate(control.value)) {
    sortRowsByDate();
    renderTable();
    updateButtonState();
    const selectedDate = csvTable.querySelector(`tr[data-row="${selectedRowIndex}"] input[data-column="0"]`);
    if (selectedDate) selectedDate.focus();
  } else {
    validateRows();
  }
  scheduleAnalytics(true);
});

errorCountLabel.addEventListener('click', focusFirstError);

csvTable.addEventListener('click', (event) => {
  const row = event.target.closest('tbody tr');
  if (!row || !isEditing) return;
  selectedRowIndex = Number(row.dataset.row);
  csvTable.querySelectorAll('tbody tr').forEach((tableRow) => {
    tableRow.classList.toggle('selected', tableRow === row);
  });
  updateButtonState();
});

csvTable.addEventListener('focusin', (event) => {
  const control = event.target.closest('input[data-column], select[data-column]');
  const row = control?.closest('tbody tr');
  if (!row || !isEditing) return;
  selectedRowIndex = Number(row.dataset.row);
  csvTable.querySelectorAll('tbody tr').forEach((tableRow) => {
    tableRow.classList.toggle('selected', tableRow === row);
  });
  updateButtonState();
});

deleteRowButton.addEventListener('click', () => {
  if (!isEditing || selectedRowIndex === null) return;
  csvRows.splice(selectedRowIndex, 1);
  selectedRowIndex = csvRows.length ? Math.min(selectedRowIndex, csvRows.length - 1) : null;
  renderTable();
  updateButtonState();
  scheduleAnalytics(true);
});

exportCsvButton.addEventListener('click', () => {
  if (!validateRows()) {
    setStatus('Fix the highlighted values before exporting.', true);
    return;
  }
  const csvText = [HEADINGS, ...csvRows].map((row) => row.map((value) => {
    const escapedValue = String(value).replace(/"/g, '""');
    return /[",\n\r]/.test(escapedValue) ? `"${escapedValue}"` : escapedValue;
  }).join(',')).join('\r\n');
  const lastDate = csvRows[csvRows.length - 1][0] || 'export';
  const downloadUrl = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }));
  const downloadLink = document.createElement('a');
  downloadLink.href = downloadUrl;
  downloadLink.download = `${lastDate}.csv`;
  document.body.append(downloadLink);
  downloadLink.click();
  setTimeout(() => {
    downloadLink.remove();
    URL.revokeObjectURL(downloadUrl);
  }, 0);
  setStatus(`Exported ${lastDate}.csv.`);
});

window.addEventListener('beforeunload', (event) => {
  // Only warn if there's actually something that could be lost. Previously this
  // fired on every visit, even before any CSV had ever been opened.
  if (!hasCsv) return;
  event.preventDefault();
  event.returnValue = '';
});

renderTable();
renderFilters([]);
updateAnalytics(false, true);
