let lastPayload = null;

const els = {
  code: document.getElementById("code"),
  n: document.getElementById("n"),
  start: document.getElementById("start"),
  end: document.getElementById("end"),
  priceLow: document.getElementById("priceLow"),
  priceHigh: document.getElementById("priceHigh"),
  buy: document.getElementById("buy"),
  shares: document.getElementById("shares"),
  btn: document.getElementById("btn"),
  downloadCsv: document.getElementById("downloadCsv"),
  exportXlsx: document.getElementById("exportXlsx"),
  summary: document.getElementById("summary"),
  table: document.getElementById("table"),
  nBox: document.getElementById("nBox"),
  rangeBox: document.getElementById("rangeBox"),
};

initDefaults();
bindModeSwitch();
bindSummaryRecalc();

els.btn.addEventListener("click", runQuery);
els.downloadCsv.addEventListener("click", downloadCsv);
els.exportXlsx.addEventListener("click", exportXlsx);

renderEmptyState();

function initDefaults() {
  const today = new Date();
  els.end.value = toYmd(today);
  els.start.value = toYmd(addDays(today, -180));
}

function bindModeSwitch() {
  const radios = [...document.querySelectorAll("input[name=mode]")];
  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = getMode();
      els.nBox.classList.toggle("hidden", mode !== "n");
      els.rangeBox.classList.toggle("hidden", mode !== "range");
    });
  });
}

function bindSummaryRecalc() {
  [els.buy, els.shares].forEach((input) => {
    input.addEventListener("input", () => {
      if (lastPayload?.summary) {
        renderSummary(lastPayload.summary, getBuyInfo());
      }
    });
  });
}

function getMode() {
  return document.querySelector("input[name=mode]:checked").value;
}

function readFormState() {
  return {
    code: valueOf(els.code).toUpperCase(),
    mode: getMode(),
    n: Number(valueOf(els.n) || "60"),
    start: valueOf(els.start),
    end: valueOf(els.end),
    priceLow: parseOptionalNumber(valueOf(els.priceLow)),
    priceHigh: parseOptionalNumber(valueOf(els.priceHigh)),
  };
}

function validateForm(form) {
  if (!form.code) return "请输入股票代码。";

  if (form.mode === "n") {
    if (!Number.isInteger(form.n) || form.n < 5 || form.n > 2000) {
      return "最近 N 个交易日必须是 5 到 2000 之间的整数。";
    }
  } else {
    if (!isYmd(form.start) || !isYmd(form.end)) {
      return "自定义日期请使用 YYYYMMDD 格式。";
    }
    if (form.start > form.end) {
      return "开始日期不能晚于结束日期。";
    }
  }

  const hasLow = form.priceLow != null;
  const hasHigh = form.priceHigh != null;
  if (hasLow !== hasHigh) {
    return "价格区间请同时填写下限和上限。";
  }
  if (hasLow && (form.priceLow < 0 || form.priceHigh < 0)) {
    return "价格区间不能为负数。";
  }
  if (hasLow && form.priceLow > form.priceHigh) {
    return "价格区间下限不能大于上限。";
  }

  return "";
}

async function runQuery() {
  const form = readFormState();
  const validationError = validateForm(form);
  if (validationError) {
    handleQueryError(validationError);
    return;
  }

  setLoadingState(true);
  setSummary("<div>查询中...</div>");
  clearVisuals();

  try {
    const qs = new URLSearchParams({ code: form.code, mode: form.mode });

    if (form.mode === "n") {
      qs.set("n", String(form.n));
    } else {
      qs.set("start", form.start);
      qs.set("end", form.end);
    }

    if (form.priceLow != null && form.priceHigh != null) {
      qs.set("price_low", String(form.priceLow));
      qs.set("price_high", String(form.priceHigh));
    }

    const response = await fetch(`/api/stock?${qs.toString()}`);
    const text = await response.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`接口返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }

    const summary = normalizeSummary(payload.summary, payload.items, {
      tsCode: payload.ts_code,
      nameCn: payload.name_cn,
      mode: payload.mode,
    });

    lastPayload = { ...payload, summary };
    disableDownloads(false);
    renderSummary(summary, getBuyInfo());
    renderCharts(payload.items, summary);
    renderTable(payload.items, summary);
  } catch (error) {
    handleQueryError(error?.message || String(error));
  } finally {
    setLoadingState(false);
  }
}

function normalizeSummary(summary, items, meta) {
  const s = { ...(summary || {}) };

  s.ts_code = s.ts_code ?? meta.tsCode ?? "";
  s.name_cn = s.name_cn ?? meta.nameCn ?? "";
  s.mode = s.mode ?? meta.mode ?? "";

  s.start = s.start ?? s.start_date ?? items?.[0]?.trade_date ?? "";
  s.end = s.end ?? s.end_date ?? items?.[items.length - 1]?.trade_date ?? "";
  s.count = s.count ?? items?.length ?? 0;

  s.today_close = s.today_close ?? s.close_latest ?? null;
  s.mean = s.mean ?? s.close_mean ?? null;
  s.high = s.high ?? s.close_max ?? null;
  s.low = s.low ?? s.close_min ?? null;

  s.turnover_latest = s.turnover_latest ?? s.tor_latest ?? null;
  s.turnover_mean = s.turnover_mean ?? s.tor_mean ?? null;
  s.turnover_max = s.turnover_max ?? s.tor_max ?? null;
  s.turnover_min = s.turnover_min ?? s.tor_min ?? null;

  s.high_date_short = s.high_date_short ?? shortDate(s.high_date);
  s.low_date_short = s.low_date_short ?? shortDate(s.low_date);
  s.turnover_max_date_short = s.turnover_max_date_short ?? shortDate(s.turnover_max_date);
  s.turnover_min_date_short = s.turnover_min_date_short ?? shortDate(s.turnover_min_date);

  if (Number.isFinite(s.today_close) && Number.isFinite(s.mean) && !Number.isFinite(s.dev_vs_mean) && s.mean !== 0) {
    s.dev_vs_mean = (s.today_close - s.mean) / s.mean;
  }
  if (Number.isFinite(s.high) && Number.isFinite(s.low) && !Number.isFinite(s.amplitude) && s.low !== 0) {
    s.amplitude = (s.high - s.low) / s.low;
  }
  if (Number.isFinite(s.today_close) && Number.isFinite(s.low) && !Number.isFinite(s.rise_from_low) && s.low !== 0) {
    s.rise_from_low = (s.today_close - s.low) / s.low;
  }
  if (Number.isFinite(s.today_close) && Number.isFinite(s.high) && !Number.isFinite(s.drawdown_from_high) && s.high !== 0) {
    s.drawdown_from_high = (s.today_close - s.high) / s.high;
  }
  if (
    Number.isFinite(s.today_close) &&
    Number.isFinite(s.high) &&
    Number.isFinite(s.low) &&
    !Number.isFinite(s.pos_pct) &&
    s.high !== s.low
  ) {
    s.pos_pct = ((s.today_close - s.low) / (s.high - s.low)) * 100;
  }
  if (s.price_range_enabled && !Number.isFinite(s.price_range_ratio) && s.count > 0) {
    s.price_range_ratio = (s.price_range_count || 0) / s.count;
  }

  return s;
}

function getBuyInfo() {
  const buy = parseOptionalNumber(valueOf(els.buy));
  const shares = parseOptionalNumber(valueOf(els.shares));
  return {
    buy: buy != null && buy > 0 ? buy : null,
    shares: shares != null && shares > 0 ? shares : null,
  };
}

function renderSummary(summary, buyInfo) {
  if (!summary) {
    renderEmptyState();
    return;
  }

  const pos = clamp(summary.pos_pct ?? 0, 0, 100);
  const todayClose = summary.today_close;
  const buy = buyInfo.buy;
  let buyLine = "";

  if (buy != null && Number.isFinite(todayClose)) {
    const diff = todayClose - buy;
    const ret = buy === 0 ? null : diff / buy;
    const floatingPnl = buyInfo.shares ? diff * buyInfo.shares : null;
    buyLine = `
      <div class="krow">
        <div class="kcell">我的买入价：<b>${formatNumber(buy)}</b></div>
        <div class="kcell">每股盈亏：<b>${withSign(diff)}</b></div>
        <div class="kcell">收益率：<b>${formatPercent(ret)}</b></div>
        <div class="kcell">浮动盈亏（元）：<b>${floatingPnl == null ? "-" : withSign(floatingPnl)}</b></div>
      </div>
    `;
  }

  const priceRangeLine = summary.price_range_enabled
    ? `
      <div class="krow">
        <div class="kcell">价格区间：<b>${formatNumber(summary.price_range_low)} ~ ${formatNumber(summary.price_range_high)}</b></div>
        <div class="kcell">命中次数：<b>${summary.price_range_count ?? 0}</b></div>
        <div class="kcell">命中占比：<b>${formatPercent(summary.price_range_ratio)}</b></div>
        <div class="kcell">命中日期：<b>${previewDates(summary.price_range_dates)}</b></div>
      </div>
    `
    : `
      <div class="muted">未启用价格区间命中统计。</div>
    `;

  setSummary(`
    <div class="krow">
      <div class="kcell">股票：<b>${escapeHtml(summary.name_cn || "-")}（${escapeHtml(summary.ts_code || "-")}）</b></div>
      <div class="kcell">截至：<b>${cnDate(summary.end)}</b></div>
      <div class="kcell">最新收盘价：<b>${formatNumber(summary.today_close)}</b></div>
      <div class="kcell">区间均价：<b>${formatNumber(summary.mean)}</b>（${formatPercent(summary.dev_vs_mean)} 相对均值）</div>
    </div>

    <div class="krow">
      <div class="kcell">区间最高价：<b>${formatNumber(summary.high)}</b>（${escapeHtml(summary.high_date_short || "-")}）</div>
      <div class="kcell">区间最低价：<b>${formatNumber(summary.low)}</b>（${escapeHtml(summary.low_date_short || "-")}）</div>
      <div class="kcell">相对区间低点：<b>${formatPercent(summary.rise_from_low)}</b></div>
      <div class="kcell">相对区间高点回撤：<b>${formatPercent(summary.drawdown_from_high)}</b></div>
    </div>

    <div class="krow">
      <div class="kcell">换手率（最新）：<b>${formatPercentRaw(summary.turnover_latest)}</b></div>
      <div class="kcell">换手率（均值）：<b>${formatPercentRaw(summary.turnover_mean)}</b></div>
      <div class="kcell">换手率（最高）：<b>${formatPercentRaw(summary.turnover_max)}</b>（${escapeHtml(summary.turnover_max_date_short || "-")}）</div>
      <div class="kcell">换手率（最低）：<b>${formatPercentRaw(summary.turnover_min)}</b>（${escapeHtml(summary.turnover_min_date_short || "-")}）</div>
    </div>

    <div class="krow">
      <div class="kcell">区间振幅：<b>${formatPercent(summary.amplitude)}</b></div>
      <div class="kcell">区间位置：<b>${pos.toFixed(1)}%</b></div>
      <div class="kcell"><div class="progress"><div class="bar" style="width:${pos}%;"></div></div></div>
      <div class="kcell muted">0% 靠近区间低点；100% 靠近区间高点。</div>
    </div>

    ${priceRangeLine}
    ${buyLine}
    <div class="muted">说明：这里的“最新收盘价”使用所选区间内最新交易日的收盘价，不是盘中实时价。</div>
  `);
}

function renderCharts(items, summary) {
  clearCharts();
  if (!Array.isArray(items) || !items.length || !window.Plotly) {
    return;
  }

  const x = items.map((item) => toDateObj(item.trade_date));
  const closes = items.map((item) => item.close);
  const tors = items.map((item) => item.turnover_rate ?? null);
  const hitItems = items.filter((item) => item.in_price_range);

  const closeTraces = [
    {
      x,
      y: closes,
      type: "scatter",
      mode: "lines",
      name: "收盘价",
      line: { color: "#111", width: 2 },
      hovertemplate: "日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
    {
      x: [x[x.length - 1]],
      y: [closes[closes.length - 1]],
      type: "scatter",
      mode: "markers",
      name: "最新收盘",
      marker: { size: 9, color: "#111" },
      hovertemplate: "最新收盘<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
    {
      x: [x[findValueIndex(closes, summary.high)]],
      y: [summary.high],
      type: "scatter",
      mode: "markers+text",
      name: "区间最高",
      marker: { size: 10, color: "#b42318" },
      text: [`最高 ${formatNumber(summary.high)}`],
      textposition: "top center",
      hovertemplate: "区间最高<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
    {
      x: [x[findValueIndex(closes, summary.low)]],
      y: [summary.low],
      type: "scatter",
      mode: "markers+text",
      name: "区间最低",
      marker: { size: 10, color: "#0c6b58" },
      text: [`最低 ${formatNumber(summary.low)}`],
      textposition: "bottom center",
      hovertemplate: "区间最低<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
  ];

  if (summary.price_range_enabled && hitItems.length) {
    closeTraces.push({
      x: hitItems.map((item) => toDateObj(item.trade_date)),
      y: hitItems.map((item) => item.close),
      type: "scatter",
      mode: "markers",
      name: "命中价格区间",
      marker: { size: 9, color: "#175cd3", symbol: "diamond" },
      hovertemplate: "命中区间<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    });
  }

  const shapes = [];
  if (Number.isFinite(summary.mean)) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "y",
      x0: x[0],
      x1: x[x.length - 1],
      y0: summary.mean,
      y1: summary.mean,
      line: { width: 1, dash: "dot", color: "#667085" },
    });
  }
  shapes.push(...buildPriceRangeShapes(summary, x));

  const annotations = [];
  if (Number.isFinite(summary.mean)) {
    annotations.push({
      x: x[x.length - 1],
      y: summary.mean,
      xref: "x",
      yref: "y",
      text: `均值：${formatNumber(summary.mean)}`,
      showarrow: false,
      xanchor: "left",
    });
  }
  if (Number.isFinite(summary.high)) {
    annotations.push({
      x: x[x.length - 1],
      y: summary.high,
      xref: "x",
      yref: "y",
      text: `最高：${formatNumber(summary.high)}`,
      showarrow: false,
      xanchor: "left",
    });
  }
  if (Number.isFinite(summary.low)) {
    annotations.push({
      x: x[x.length - 1],
      y: summary.low,
      xref: "x",
      yref: "y",
      text: `最低：${formatNumber(summary.low)}`,
      showarrow: false,
      xanchor: "left",
    });
  }
  if (summary.price_range_enabled && Number.isFinite(summary.price_range_high)) {
    annotations.push({
      x: x[0],
      y: summary.price_range_high,
      xref: "x",
      yref: "y",
      text: `价格区间：${formatNumber(summary.price_range_low)} ~ ${formatNumber(summary.price_range_high)}`,
      showarrow: false,
      xanchor: "left",
      yanchor: "bottom",
      bgcolor: "rgba(23,92,211,0.08)",
    });
  }

  Plotly.newPlot(
    "chartClose",
    closeTraces,
    {
      title: `${summary.ts_code || ""}｜${cnDate(summary.start)} ~ ${cnDate(summary.end)}｜共 ${summary.count ?? items.length} 个交易日`,
      margin: { l: 48, r: 24, t: 64, b: 40 },
      xaxis: { title: "日期" },
      yaxis: { title: "收盘价" },
      hovermode: "x unified",
      legend: { orientation: "h", y: 1.14, x: 1, xanchor: "right" },
      shapes,
      annotations,
    },
    { displayModeBar: false, responsive: true }
  );

  Plotly.newPlot(
    "chartTor",
    [
      {
        x,
        y: tors,
        type: "bar",
        name: "换手率（%）",
        marker: { color: "#444ce7" },
        hovertemplate: "日期=%{x|%Y年%m月%d日}<br>换手率=%{y:.2f}%<extra></extra>",
      },
    ],
    {
      margin: { l: 48, r: 24, t: 16, b: 40 },
      xaxis: { title: "日期" },
      yaxis: { title: "换手率（%）" },
    },
    { displayModeBar: false, responsive: true }
  );
}

function renderTable(items, summary) {
  if (!Array.isArray(items) || !items.length) {
    els.table.innerHTML = "<div class=\"muted\">暂无数据。</div>";
    return;
  }

  const showRangeColumn = Boolean(summary?.price_range_enabled);
  const rows = items.slice().reverse();

  const html = `
    <table>
      <thead>
        <tr>
          <th>日期</th>
          <th>收盘价</th>
          <th>换手率（%）</th>
          ${showRangeColumn ? "<th>是否命中价格区间</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((item) => {
            const hitCell = showRangeColumn
              ? `<td><span class="pill ${item.in_price_range ? "pill-hit" : "pill-miss"}">${item.in_price_range ? "命中" : "未命中"}</span></td>`
              : "";

            return `
              <tr>
                <td>${cnDate(item.trade_date)}</td>
                <td>${formatNumber(item.close)}</td>
                <td>${formatNumber(item.turnover_rate)}</td>
                ${hitCell}
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  els.table.innerHTML = html;
}

function downloadCsv() {
  if (!lastPayload?.items?.length) return;

  const includeRangeColumn = Boolean(lastPayload.summary?.price_range_enabled);
  const header = ["日期", "收盘价", "换手率（%）"];
  if (includeRangeColumn) header.push("是否命中价格区间");

  const lines = [header.map(csvEscape).join(",")];

  for (const item of lastPayload.items) {
    const row = [
      cnDate(item.trade_date),
      formatNumber(item.close),
      item.turnover_rate == null ? "" : formatNumber(item.turnover_rate),
    ];
    if (includeRangeColumn) row.push(item.in_price_range ? "命中" : "未命中");
    lines.push(row.map(csvEscape).join(","));
  }

  const csv = "\ufeff" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${filenameBase()}.csv`);
}

function exportXlsx() {
  if (!lastPayload?.items?.length || !lastPayload?.summary || !window.XLSX) return;

  const summary = lastPayload.summary;
  const buyInfo = getBuyInfo();
  const overviewRows = [
    ["股票代码", summary.ts_code],
    ["股票名称", summary.name_cn || ""],
    ["区间模式", summary.mode === "n" ? "最近 N 个交易日" : "自定义起止日期"],
    ["区间开始", cnDate(summary.start)],
    ["区间结束", cnDate(summary.end)],
    ["交易日数量", summary.count],
    ["最新收盘价", summary.today_close],
    ["区间均价", summary.mean],
    ["区间最高价", summary.high],
    ["最高价日期", summary.high_date_short || "-"],
    ["区间最低价", summary.low],
    ["最低价日期", summary.low_date_short || "-"],
    ["相对区间低点(%)", toPercentNumber(summary.rise_from_low)],
    ["相对区间高点回撤(%)", toPercentNumber(summary.drawdown_from_high)],
    ["区间振幅(%)", toPercentNumber(summary.amplitude)],
    ["区间位置(%)", summary.pos_pct],
    ["换手率最新值(%)", summary.turnover_latest],
    ["换手率均值(%)", summary.turnover_mean],
    ["换手率最高值(%)", summary.turnover_max],
    ["换手率最高日期", summary.turnover_max_date_short || "-"],
    ["换手率最低值(%)", summary.turnover_min],
    ["换手率最低日期", summary.turnover_min_date_short || "-"],
  ];

  if (summary.price_range_enabled) {
    overviewRows.push(["价格区间下限", summary.price_range_low]);
    overviewRows.push(["价格区间上限", summary.price_range_high]);
    overviewRows.push(["命中次数", summary.price_range_count ?? 0]);
    overviewRows.push(["命中占比(%)", toPercentNumber(summary.price_range_ratio)]);
    overviewRows.push(["命中日期", (summary.price_range_dates || []).map(cnDate).join("、") || "-"]);
  }

  if (buyInfo.buy != null && Number.isFinite(summary.today_close)) {
    const diff = summary.today_close - buyInfo.buy;
    overviewRows.push(["我的买入价", buyInfo.buy]);
    overviewRows.push(["每股盈亏", diff]);
    overviewRows.push(["收益率(%)", toPercentNumber(diff / buyInfo.buy)]);
    if (buyInfo.shares) overviewRows.push(["浮动盈亏(元)", diff * buyInfo.shares]);
  }

  const detailRows = [
    ["日期", "收盘价", "换手率（%）", ...(summary.price_range_enabled ? ["是否命中价格区间"] : [])],
    ...lastPayload.items.map((item) => [
      cnDate(item.trade_date),
      Number.isFinite(item.close) ? Number(item.close) : "",
      Number.isFinite(item.turnover_rate) ? Number(item.turnover_rate) : "",
      ...(summary.price_range_enabled ? [item.in_price_range ? "命中" : "未命中"] : []),
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewRows), "查询概览");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "区间明细");
  XLSX.writeFile(wb, `${filenameBase()}_查询结果.xlsx`);
}

function handleQueryError(message) {
  lastPayload = null;
  disableDownloads(true);
  clearVisuals();
  setSummary(`<div class="error">查询失败：${escapeHtml(message)}</div>`);
}

function renderEmptyState() {
  clearVisuals();
  setSummary("<div class=\"muted\">请输入股票代码并发起查询。</div>");
}

function setLoadingState(isLoading) {
  els.btn.disabled = isLoading;
  els.btn.textContent = isLoading ? "查询中..." : "查询";
  if (isLoading) disableDownloads(true);
}

function clearVisuals() {
  clearCharts();
  els.table.innerHTML = "<div class=\"muted\">暂无数据。</div>";
}

function clearCharts() {
  const closeChart = document.getElementById("chartClose");
  const turnoverChart = document.getElementById("chartTor");
  if (window.Plotly) {
    Plotly.purge(closeChart);
    Plotly.purge(turnoverChart);
  }
  closeChart.innerHTML = "";
  turnoverChart.innerHTML = "";
}

function disableDownloads(disabled) {
  els.downloadCsv.disabled = disabled;
  els.exportXlsx.disabled = disabled;
}

function setSummary(html) {
  els.summary.innerHTML = html;
}

function valueOf(input) {
  return input.value.trim();
}

function parseOptionalNumber(raw) {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "-";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(Number(value) * 100).toFixed(2)}%` : "-";
}

function formatPercentRaw(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(2)}%` : "-";
}

function toPercentNumber(value) {
  return Number.isFinite(value) ? Number(value) * 100 : "";
}

function withSign(value) {
  if (!Number.isFinite(value)) return "-";
  const num = Number(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}`;
}

function previewDates(dates) {
  if (!Array.isArray(dates) || !dates.length) return "-";
  const preview = dates.slice(0, 6).map(cnDate).join("、");
  return dates.length > 6 ? `${preview} 等 ${dates.length} 次` : preview;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function filenameBase() {
  const code = (lastPayload?.summary?.ts_code || valueOf(els.code) || "stock").trim().toUpperCase();
  const name = (lastPayload?.summary?.name_cn || "").trim();
  const end = lastPayload?.summary?.end || toYmd(new Date());
  const safeName = name.replace(/[\\/:*?"<>|]/g, "");
  return safeName ? `${safeName}_${code}_${end}` : `${code}_${end}`;
}

function isYmd(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const date = toDateObj(value);
  return toYmd(date) === value;
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function addDays(date, delta) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + delta);
  return next;
}

function toDateObj(yyyymmdd) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(y, m, d);
}

function cnDate(yyyymmdd) {
  if (!isYmd(yyyymmdd)) return escapeHtml(yyyymmdd || "-");
  const date = toDateObj(yyyymmdd);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function shortDate(yyyymmdd) {
  return isYmd(yyyymmdd) ? cnDate(yyyymmdd) : "-";
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function findValueIndex(values, target) {
  const index = values.findIndex((value) => Number.isFinite(target) && value === target);
  return index >= 0 ? index : values.length - 1;
}

function buildPriceRangeShapes(summary, xValues) {
  if (!summary.price_range_enabled || !Number.isFinite(summary.price_range_low) || !Number.isFinite(summary.price_range_high)) {
    return [];
  }

  if (summary.price_range_low === summary.price_range_high) {
    return [
      {
        type: "line",
        xref: "x",
        yref: "y",
        x0: xValues[0],
        x1: xValues[xValues.length - 1],
        y0: summary.price_range_low,
        y1: summary.price_range_low,
        line: { width: 2, dash: "dash", color: "#175cd3" },
      },
    ];
  }

  return [
    {
      type: "rect",
      xref: "x",
      yref: "y",
      x0: xValues[0],
      x1: xValues[xValues.length - 1],
      y0: summary.price_range_low,
      y1: summary.price_range_high,
      fillcolor: "rgba(23,92,211,0.08)",
      line: { width: 0 },
      layer: "below",
    },
  ];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
