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
  overviewPanel: document.getElementById("overviewPanel"),
  rangeStatsPanel: document.getElementById("rangeStatsPanel"),
  turnoverTable: document.getElementById("turnoverTable"),
  table: document.getElementById("table"),
  nBox: document.getElementById("nBox"),
  rangeBox: document.getElementById("rangeBox"),
  chartClose: document.getElementById("chartClose"),
  chartTor: document.getElementById("chartTor"),
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
  els.end.value = toInputDate(today);
  els.start.value = toInputDate(addDays(today, -180));
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
      if (!lastPayload?.summary || !Array.isArray(lastPayload?.items)) return;
      renderResultPanels(lastPayload.summary, lastPayload.items);
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
    start: normalizeInputDate(valueOf(els.start)),
    end: normalizeInputDate(valueOf(els.end)),
    priceLow: parseOptionalNumber(valueOf(els.priceLow)),
    priceHigh: parseOptionalNumber(valueOf(els.priceHigh)),
  };
}

function validateForm(form) {
  if (!form.code) return "请输入股票代码。";

  if (form.mode === "n") {
    if (!Number.isInteger(form.n) || form.n < 5 || form.n > 2000) {
      return "最近交易日数量必须是 5 到 2000 之间的整数。";
    }
  } else {
    if (!isYmd(form.start) || !isYmd(form.end)) {
      return "开始日期和结束日期都需要通过日历选择。";
    }
    if (form.start > form.end) {
      return "开始日期不能晚于结束日期。";
    }
  }

  const hasLow = form.priceLow != null;
  const hasHigh = form.priceHigh != null;
  if (hasLow !== hasHigh) {
    return "价格区间需要同时填写下限和上限。";
  }
  if (hasLow && (form.priceLow < 0 || form.priceHigh < 0)) {
    return "价格区间不能为负数。";
  }
  if (hasLow && form.priceLow > form.priceHigh) {
    return "价格下限不能大于价格上限。";
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
  renderLoadingPanels();
  clearTablesAndCharts();

  try {
    const qs = new URLSearchParams({
      code: form.code,
      mode: form.mode,
    });

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
      throw new Error(`接口返回的内容不是 JSON，HTTP 状态码为 ${response.status}。`);
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.msg || `请求失败，HTTP 状态码为 ${response.status}。`);
    }

    const summary = normalizeSummary(payload.summary, payload.items, {
      tsCode: payload.ts_code,
      nameCn: payload.name_cn,
      mode: payload.mode,
    });

    lastPayload = { ...payload, summary };
    disableDownloads(false);
    renderResultPanels(summary, payload.items);
    renderCharts(payload.items, summary);
    renderTurnoverTable(payload.items, summary);
    renderDataTable(payload.items, summary);
  } catch (error) {
    handleQueryError(error?.message || String(error));
  } finally {
    setLoadingState(false);
  }
}

function normalizeSummary(summary, items, meta) {
  const normalized = { ...(summary || {}) };

  normalized.ts_code = normalized.ts_code ?? meta.tsCode ?? "";
  normalized.name_cn = normalized.name_cn ?? meta.nameCn ?? "";
  normalized.mode = normalized.mode ?? meta.mode ?? "";

  normalized.start = normalized.start ?? normalized.start_date ?? items?.[0]?.trade_date ?? "";
  normalized.end = normalized.end ?? normalized.end_date ?? items?.[items.length - 1]?.trade_date ?? "";
  normalized.count = normalized.count ?? items?.length ?? 0;

  normalized.today_close = normalized.today_close ?? normalized.close_latest ?? null;
  normalized.mean = normalized.mean ?? normalized.close_mean ?? null;
  normalized.high = normalized.high ?? normalized.close_max ?? null;
  normalized.low = normalized.low ?? normalized.close_min ?? null;

  normalized.turnover_latest = normalized.turnover_latest ?? normalized.tor_latest ?? null;
  normalized.turnover_mean = normalized.turnover_mean ?? normalized.tor_mean ?? null;
  normalized.turnover_max = normalized.turnover_max ?? normalized.tor_max ?? null;
  normalized.turnover_min = normalized.turnover_min ?? normalized.tor_min ?? null;

  normalized.high_date_short = normalized.high_date_short ?? shortDate(normalized.high_date);
  normalized.low_date_short = normalized.low_date_short ?? shortDate(normalized.low_date);
  normalized.turnover_max_date_short = normalized.turnover_max_date_short ?? shortDate(normalized.turnover_max_date);
  normalized.turnover_min_date_short = normalized.turnover_min_date_short ?? shortDate(normalized.turnover_min_date);

  if (
    Number.isFinite(normalized.today_close) &&
    Number.isFinite(normalized.mean) &&
    !Number.isFinite(normalized.dev_vs_mean) &&
    normalized.mean !== 0
  ) {
    normalized.dev_vs_mean = (normalized.today_close - normalized.mean) / normalized.mean;
  }
  if (
    Number.isFinite(normalized.high) &&
    Number.isFinite(normalized.low) &&
    !Number.isFinite(normalized.amplitude) &&
    normalized.low !== 0
  ) {
    normalized.amplitude = (normalized.high - normalized.low) / normalized.low;
  }
  if (
    Number.isFinite(normalized.today_close) &&
    Number.isFinite(normalized.low) &&
    !Number.isFinite(normalized.rise_from_low) &&
    normalized.low !== 0
  ) {
    normalized.rise_from_low = (normalized.today_close - normalized.low) / normalized.low;
  }
  if (
    Number.isFinite(normalized.today_close) &&
    Number.isFinite(normalized.high) &&
    !Number.isFinite(normalized.drawdown_from_high) &&
    normalized.high !== 0
  ) {
    normalized.drawdown_from_high = (normalized.today_close - normalized.high) / normalized.high;
  }
  if (
    Number.isFinite(normalized.today_close) &&
    Number.isFinite(normalized.high) &&
    Number.isFinite(normalized.low) &&
    !Number.isFinite(normalized.pos_pct) &&
    normalized.high !== normalized.low
  ) {
    normalized.pos_pct = ((normalized.today_close - normalized.low) / (normalized.high - normalized.low)) * 100;
  }
  if (normalized.price_range_enabled && !Number.isFinite(normalized.price_range_ratio) && normalized.count > 0) {
    normalized.price_range_ratio = (normalized.price_range_count || 0) / normalized.count;
  }

  return normalized;
}

function renderResultPanels(summary, items) {
  renderOverview(summary, items, getBuyInfo());
  renderRangeStats(summary, items);
}

function renderOverview(summary, items, buyInfo) {
  const pos = clamp(summary.pos_pct ?? 0, 0, 100);
  const buySection = renderBuySection(summary, buyInfo);
  const rangeEnabledText = summary.price_range_enabled
    ? `已启用价格区间统计：${formatNumber(summary.price_range_low)} 元到 ${formatNumber(summary.price_range_high)} 元。`
    : "当前未启用价格区间统计。";

  els.overviewPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="panel-kicker">查询概览</p>
        <h2>${escapeHtml(summary.name_cn || "未命名股票")}（${escapeHtml(summary.ts_code || "-")}）</h2>
      </div>
    </div>

    <div class="overview-block">
      <div class="metric-grid">
        ${renderMetricCard("最新收盘价", `${formatNumber(summary.today_close)} 元`, `统计截至 ${cnDate(summary.end)}`)}
        ${renderMetricCard("区间均价", `${formatNumber(summary.mean)} 元`, `相对均值 ${formatSignedPercent(summary.dev_vs_mean)}`)}
        ${renderMetricCard("区间最高价", `${formatNumber(summary.high)} 元`, `出现于 ${escapeHtml(summary.high_date_short || "-")}`)}
        ${renderMetricCard("区间最低价", `${formatNumber(summary.low)} 元`, `出现于 ${escapeHtml(summary.low_date_short || "-")}`)}
      </div>
    </div>

    <div class="overview-block">
      <h3>区间位置与波动</h3>
      <div class="kv-grid">
        ${renderKvCard("交易日区间", `${cnDate(summary.start)} 至 ${cnDate(summary.end)}`)}
        ${renderKvCard("交易日数量", `${summary.count ?? items.length} 个交易日`)}
        ${renderKvCard("区间振幅", formatPercent(summary.amplitude))}
        ${renderKvCard("相对区间低点", formatPercent(summary.rise_from_low))}
        ${renderKvCard("相对区间高点回撤", formatPercent(summary.drawdown_from_high))}
        ${renderKvCard("价格区间统计", rangeEnabledText)}
      </div>

      <div class="progress-wrap">
        <div class="progress-meta">
          <span>区间位置</span>
          <span>${pos.toFixed(1)}%</span>
        </div>
        <div class="progress"><div class="bar" style="width:${pos}%;"></div></div>
        <p class="help-text">0% 表示更靠近区间低点，100% 表示更靠近区间高点。</p>
      </div>
    </div>

    <div class="overview-block">
      <h3>换手率摘要</h3>
      <div class="metric-grid">
        ${renderMetricCard("最新换手率", formatPercentRaw(summary.turnover_latest), `最新交易日 ${cnDate(summary.end)}`)}
        ${renderMetricCard("平均换手率", formatPercentRaw(summary.turnover_mean), "当前统计区间平均值")}
        ${renderMetricCard("最高换手率", formatPercentRaw(summary.turnover_max), `出现于 ${escapeHtml(summary.turnover_max_date_short || "-")}`)}
        ${renderMetricCard("最低换手率", formatPercentRaw(summary.turnover_min), `出现于 ${escapeHtml(summary.turnover_min_date_short || "-")}`)}
      </div>
    </div>

    ${buySection}
  `;
}

function renderRangeStats(summary, items) {
  const insights = buildRangeInsights(summary, items);

  if (!summary.price_range_enabled) {
    els.rangeStatsPanel.innerHTML = `
      <div class="panel-head">
        <div>
          <p class="panel-kicker">价格区间统计</p>
          <h2>价格区间专项分析</h2>
        </div>
      </div>
      <div class="empty-box">填写价格下限和上限后，这里会单独展示命中次数、命中占比、首次命中、最近命中，以及命中日期列表。</div>
    `;
    return;
  }

  const hitDateTags = insights.hitDates.length
    ? insights.hitDates.map((date) => `<span class="hit-tag">${cnDate(date)}</span>`).join("")
    : '<span class="hit-tag">当前区间内没有命中日期</span>';

  els.rangeStatsPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="panel-kicker">价格区间统计</p>
        <h2>价格区间专项分析</h2>
      </div>
    </div>

    <div class="range-block">
      <div class="range-banner">
        <span class="range-chip">统计区间：${formatNumber(summary.price_range_low)} 元至 ${formatNumber(summary.price_range_high)} 元</span>
        <span class="range-chip">命中 ${insights.hitCount} 次</span>
        <span class="range-chip">命中占比 ${formatPercent(insights.hitRatio)}</span>
      </div>
    </div>

    <div class="range-block">
      <div class="metric-grid">
        ${renderMetricCard("首次命中日期", insights.firstHitDate ? cnDate(insights.firstHitDate) : "暂无", "统计区间内最早一次命中")}
        ${renderMetricCard("最近命中日期", insights.lastHitDate ? cnDate(insights.lastHitDate) : "暂无", "统计区间内最近一次命中")}
        ${renderMetricCard("命中收盘价范围", insights.hitCloseRange, insights.hitCloseNote)}
        ${renderMetricCard("最长连续命中", `${insights.longestHitStreak} 个交易日`, insights.longestHitStreakNote)}
        ${renderMetricCard("未命中交易日", `${insights.missCount} 个交易日`, "用于判断该价格区间出现的稀疏程度")}
        ${renderMetricCard("距区间末端", insights.distanceFromLastHitText, "表示最近一次命中距离查询终点还有多少个交易日")}
      </div>
    </div>

    <div class="range-block">
      <h3>命中日期列表</h3>
      <div class="hit-list">${hitDateTags}</div>
    </div>
  `;
}

function renderCharts(items, summary) {
  clearCharts();
  if (!window.Plotly || !Array.isArray(items) || !items.length) return;

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
      line: { color: "#8b5e34", width: 3 },
      hovertemplate: "日期：%{x|%Y年%m月%d日}<br>收盘价：%{y:.2f} 元<extra></extra>",
    },
    {
      x: [x[x.length - 1]],
      y: [closes[closes.length - 1]],
      type: "scatter",
      mode: "markers",
      name: "最新收盘价",
      marker: { size: 10, color: "#5f3f20" },
      hovertemplate: "最新收盘价<br>日期：%{x|%Y年%m月%d日}<br>收盘价：%{y:.2f} 元<extra></extra>",
    },
  ];

  if (Number.isFinite(summary.high)) {
    closeTraces.push({
      x: [x[findValueIndex(closes, summary.high)]],
      y: [summary.high],
      type: "scatter",
      mode: "markers+text",
      name: "区间最高价",
      marker: { size: 10, color: "#b54708" },
      text: [`最高 ${formatNumber(summary.high)}`],
      textposition: "top center",
      hovertemplate: "区间最高价<br>日期：%{x|%Y年%m月%d日}<br>收盘价：%{y:.2f} 元<extra></extra>",
    });
  }

  if (Number.isFinite(summary.low)) {
    closeTraces.push({
      x: [x[findValueIndex(closes, summary.low)]],
      y: [summary.low],
      type: "scatter",
      mode: "markers+text",
      name: "区间最低价",
      marker: { size: 10, color: "#12715b" },
      text: [`最低 ${formatNumber(summary.low)}`],
      textposition: "bottom center",
      hovertemplate: "区间最低价<br>日期：%{x|%Y年%m月%d日}<br>收盘价：%{y:.2f} 元<extra></extra>",
    });
  }

  if (summary.price_range_enabled && hitItems.length) {
    closeTraces.push({
      x: hitItems.map((item) => toDateObj(item.trade_date)),
      y: hitItems.map((item) => item.close),
      type: "scatter",
      mode: "markers",
      name: "命中价格区间",
      marker: { size: 9, color: "#175cd3", symbol: "diamond" },
      hovertemplate: "命中价格区间<br>日期：%{x|%Y年%m月%d日}<br>收盘价：%{y:.2f} 元<extra></extra>",
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
      line: { width: 1.5, dash: "dot", color: "#946037" },
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
      text: `区间均价：${formatNumber(summary.mean)} 元`,
      showarrow: false,
      xanchor: "left",
      font: { color: "#6b5a43", size: 12 },
    });
  }
  if (summary.price_range_enabled) {
    annotations.push({
      x: x[0],
      y: summary.price_range_high,
      xref: "x",
      yref: "y",
      text: `统计价格区间：${formatNumber(summary.price_range_low)} 至 ${formatNumber(summary.price_range_high)} 元`,
      showarrow: false,
      xanchor: "left",
      yanchor: "bottom",
      bgcolor: "rgba(217, 125, 47, 0.12)",
      bordercolor: "rgba(217, 125, 47, 0.18)",
      font: { color: "#5f3f20", size: 12 },
    });
  }

  Plotly.newPlot(
    els.chartClose,
    closeTraces,
    {
      title: `${summary.ts_code || ""} · ${cnDate(summary.start)} 至 ${cnDate(summary.end)} · 共 ${summary.count ?? items.length} 个交易日`,
      margin: { l: 54, r: 24, t: 72, b: 54 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(255,255,255,0.52)",
      hovermode: "x unified",
      legend: { orientation: "h", y: 1.16, x: 1, xanchor: "right" },
      xaxis: {
        title: "日期",
        tickformat: "%Y年%m月%d日",
        gridcolor: "rgba(112, 80, 33, 0.08)",
      },
      yaxis: {
        title: "收盘价（元）",
        gridcolor: "rgba(112, 80, 33, 0.08)",
      },
      shapes,
      annotations,
    },
    { displayModeBar: false, responsive: true }
  );

  Plotly.newPlot(
    els.chartTor,
    [
      {
        x,
        y: tors,
        type: "bar",
        name: "换手率",
        marker: { color: "#d97d2f" },
        hovertemplate: "日期：%{x|%Y年%m月%d日}<br>换手率：%{y:.2f}%<extra></extra>",
      },
    ],
    {
      margin: { l: 54, r: 24, t: 20, b: 54 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(255,255,255,0.52)",
      xaxis: {
        title: "日期",
        tickformat: "%Y年%m月%d日",
        gridcolor: "rgba(112, 80, 33, 0.06)",
      },
      yaxis: {
        title: "换手率（%）",
        gridcolor: "rgba(112, 80, 33, 0.08)",
      },
    },
    { displayModeBar: false, responsive: true }
  );
}

function renderTurnoverTable(items, summary) {
  if (!Array.isArray(items) || !items.length) {
    els.turnoverTable.innerHTML = '<div class="empty-box">暂无换手率数据。</div>';
    return;
  }

  const rows = items.slice().reverse();
  const html = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>换手率</th>
            <th>相对区间均值</th>
            <th>收盘价</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((item) => {
              const delta = Number.isFinite(item.turnover_rate) && Number.isFinite(summary.turnover_mean)
                ? item.turnover_rate - summary.turnover_mean
                : null;

              return `
                <tr>
                  <td data-label="日期">${cnDate(item.trade_date)}</td>
                  <td data-label="换手率"><span class="mono">${formatPercentRaw(item.turnover_rate)}</span></td>
                  <td data-label="相对区间均值">${formatSignedPercentRaw(delta)}</td>
                  <td data-label="收盘价">${formatNumber(item.close)} 元</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  els.turnoverTable.innerHTML = html;
}

function renderDataTable(items, summary) {
  if (!Array.isArray(items) || !items.length) {
    els.table.innerHTML = '<div class="empty-box">暂无完整明细数据。</div>';
    return;
  }

  const rows = items.slice().reverse();
  const html = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>收盘价</th>
            <th>换手率</th>
            <th>价格区间命中</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((item) => `
              <tr>
                <td data-label="日期">${cnDate(item.trade_date)}</td>
                <td data-label="收盘价">${formatNumber(item.close)} 元</td>
                <td data-label="换手率">${formatPercentRaw(item.turnover_rate)}</td>
                <td data-label="价格区间命中">${renderHitBadge(item, summary)}</td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  els.table.innerHTML = html;
}

function renderBuySection(summary, buyInfo) {
  if (buyInfo.buy == null || !Number.isFinite(summary.today_close)) return "";

  const diff = summary.today_close - buyInfo.buy;
  const ret = buyInfo.buy === 0 ? null : diff / buyInfo.buy;
  const floatingPnl = buyInfo.shares ? diff * buyInfo.shares : null;

  return `
    <div class="overview-block">
      <h3>持仓辅助</h3>
      <div class="metric-grid">
        ${renderMetricCard("买入价格", `${formatNumber(buyInfo.buy)} 元`, "你填写的持仓成本价")}
        ${renderMetricCard("每股盈亏", `${withSign(diff)} 元`, "按最新收盘价估算")}
        ${renderMetricCard("收益率", formatSignedPercent(ret), "按最新收盘价估算")}
        ${renderMetricCard("浮动盈亏", floatingPnl == null ? "-" : `${withSign(floatingPnl)} 元`, buyInfo.shares ? `持股数量 ${formatInteger(buyInfo.shares)} 股` : "未填写持股数量")}
      </div>
    </div>
  `;
}

function buildRangeInsights(summary, items) {
  const hitItems = items.filter((item) => item.in_price_range);
  const hitCount = hitItems.length;
  const missCount = Math.max(0, items.length - hitCount);
  const firstHit = hitItems[0] || null;
  const lastHit = hitItems[hitItems.length - 1] || null;
  const lastHitIndex = lastHit ? items.findIndex((item) => item.trade_date === lastHit.trade_date) : -1;
  const distanceFromLastHit = lastHitIndex >= 0 ? items.length - 1 - lastHitIndex : null;
  const hitCloses = hitItems.map((item) => item.close).filter(Number.isFinite);
  const longestHitStreak = getLongestHitStreak(items);
  const recentHitDates = hitItems.slice(-12).map((item) => item.trade_date);

  return {
    hitCount,
    missCount,
    hitRatio: summary.price_range_ratio ?? (items.length ? hitCount / items.length : null),
    firstHitDate: firstHit?.trade_date ?? "",
    lastHitDate: lastHit?.trade_date ?? "",
    hitCloseRange: hitCloses.length
      ? `${formatNumber(Math.min(...hitCloses))} 元至 ${formatNumber(Math.max(...hitCloses))} 元`
      : "暂无命中",
    hitCloseNote: hitCloses.length ? "命中交易日的实际收盘价范围" : "当前区间内没有收盘价命中该价格带",
    longestHitStreak,
    longestHitStreakNote: longestHitStreak > 0 ? "连续多个交易日都落在目标价格区间内" : "当前没有连续命中记录",
    distanceFromLastHitText: distanceFromLastHit == null ? "暂无" : `${distanceFromLastHit} 个交易日`,
    hitDates: recentHitDates.length ? recentHitDates.reverse() : [],
  };
}

function getLongestHitStreak(items) {
  let current = 0;
  let longest = 0;

  for (const item of items) {
    if (item.in_price_range) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function renderMetricCard(label, value, note) {
  return `
    <div class="metric-card">
      <p class="metric-label">${label}</p>
      <strong>${value}</strong>
      <div class="metric-note">${note}</div>
    </div>
  `;
}

function renderKvCard(label, value) {
  return `
    <div class="kv-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderHitBadge(item, summary) {
  if (!summary.price_range_enabled) {
    return '<span class="badge badge-neutral">未启用</span>';
  }
  return item.in_price_range
    ? '<span class="badge badge-hit">命中</span>'
    : '<span class="badge badge-miss">未命中</span>';
}

function downloadCsv() {
  if (!lastPayload?.items?.length) return;

  const includeRangeColumn = Boolean(lastPayload.summary?.price_range_enabled);
  const header = ["日期", "收盘价（元）", "换手率（%）"];
  if (includeRangeColumn) header.push("价格区间命中");

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
  const items = lastPayload.items;
  const buyInfo = getBuyInfo();
  const insights = buildRangeInsights(summary, items);

  const overviewRows = [
    ["股票代码", summary.ts_code],
    ["股票名称", summary.name_cn || ""],
    ["统计区间开始", cnDate(summary.start)],
    ["统计区间结束", cnDate(summary.end)],
    ["交易日数量", summary.count],
    ["最新收盘价", summary.today_close],
    ["区间均价", summary.mean],
    ["区间最高价", summary.high],
    ["区间最高价日期", summary.high_date_short || "-"],
    ["区间最低价", summary.low],
    ["区间最低价日期", summary.low_date_short || "-"],
    ["区间振幅(%)", toPercentNumber(summary.amplitude)],
    ["相对区间低点(%)", toPercentNumber(summary.rise_from_low)],
    ["相对区间高点回撤(%)", toPercentNumber(summary.drawdown_from_high)],
    ["区间位置(%)", summary.pos_pct],
    ["最新换手率(%)", summary.turnover_latest],
    ["平均换手率(%)", summary.turnover_mean],
    ["最高换手率(%)", summary.turnover_max],
    ["最高换手率日期", summary.turnover_max_date_short || "-"],
    ["最低换手率(%)", summary.turnover_min],
    ["最低换手率日期", summary.turnover_min_date_short || "-"],
  ];

  if (summary.price_range_enabled) {
    overviewRows.push(["价格下限", summary.price_range_low]);
    overviewRows.push(["价格上限", summary.price_range_high]);
    overviewRows.push(["命中次数", insights.hitCount]);
    overviewRows.push(["命中占比(%)", toPercentNumber(insights.hitRatio)]);
    overviewRows.push(["首次命中日期", insights.firstHitDate ? cnDate(insights.firstHitDate) : "-"]);
    overviewRows.push(["最近命中日期", insights.lastHitDate ? cnDate(insights.lastHitDate) : "-"]);
    overviewRows.push(["命中收盘价范围", insights.hitCloseRange]);
    overviewRows.push(["最长连续命中", insights.longestHitStreak]);
    overviewRows.push(["命中日期列表", (summary.price_range_dates || []).map(cnDate).join("、") || "-"]);
  }

  if (buyInfo.buy != null && Number.isFinite(summary.today_close)) {
    const diff = summary.today_close - buyInfo.buy;
    overviewRows.push(["买入价格", buyInfo.buy]);
    overviewRows.push(["每股盈亏", diff]);
    overviewRows.push(["收益率(%)", toPercentNumber(diff / buyInfo.buy)]);
    if (buyInfo.shares) overviewRows.push(["浮动盈亏(元)", diff * buyInfo.shares]);
  }

  const detailRows = [
    ["日期", "收盘价（元）", "换手率（%）", "价格区间命中"],
    ...items.map((item) => [
      cnDate(item.trade_date),
      Number.isFinite(item.close) ? Number(item.close) : "",
      Number.isFinite(item.turnover_rate) ? Number(item.turnover_rate) : "",
      summary.price_range_enabled ? (item.in_price_range ? "命中" : "未命中") : "未启用",
    ]),
  ];

  const turnoverRows = [
    ["日期", "换手率（%）", "相对区间均值（百分点）", "收盘价（元）"],
    ...items.map((item) => [
      cnDate(item.trade_date),
      Number.isFinite(item.turnover_rate) ? Number(item.turnover_rate) : "",
      Number.isFinite(item.turnover_rate) && Number.isFinite(summary.turnover_mean)
        ? Number((item.turnover_rate - summary.turnover_mean).toFixed(2))
        : "",
      Number.isFinite(item.close) ? Number(item.close) : "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewRows), "查询概览");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "价格与命中明细");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(turnoverRows), "换手率表格视图");
  XLSX.writeFile(wb, `${filenameBase()}_查询结果.xlsx`);
}

function getBuyInfo() {
  const buy = parseOptionalNumber(valueOf(els.buy));
  const shares = parseOptionalNumber(valueOf(els.shares));
  return {
    buy: buy != null && buy > 0 ? buy : null,
    shares: shares != null && shares > 0 ? shares : null,
  };
}

function handleQueryError(message) {
  lastPayload = null;
  disableDownloads(true);
  clearTablesAndCharts();
  els.overviewPanel.innerHTML = `<div class="error-box">查询失败：${escapeHtml(message)}</div>`;
  els.rangeStatsPanel.innerHTML = '<div class="empty-box">价格区间专项分析未生成。</div>';
}

function renderEmptyState() {
  clearTablesAndCharts();
  els.overviewPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="panel-kicker">查询概览</p>
        <h2>等待查询</h2>
      </div>
    </div>
    <div class="empty-box">请输入股票代码并设置交易日区间。查询后，这里会展示价格概览、换手率摘要和持仓辅助结果。</div>
  `;
  els.rangeStatsPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="panel-kicker">价格区间统计</p>
        <h2>专项分析等待中</h2>
      </div>
    </div>
    <div class="empty-box">填写价格下限和价格上限后，系统会把命中统计单独展示在这里。</div>
  `;
}

function renderLoadingPanels() {
  els.overviewPanel.innerHTML = '<div class="muted-box">正在查询股票数据，请稍候……</div>';
  els.rangeStatsPanel.innerHTML = '<div class="muted-box">正在生成价格区间专项统计……</div>';
}

function setLoadingState(isLoading) {
  els.btn.disabled = isLoading;
  els.btn.textContent = isLoading ? "查询中…" : "开始查询";
  if (isLoading) disableDownloads(true);
}

function clearTablesAndCharts() {
  clearCharts();
  els.turnoverTable.innerHTML = '<div class="empty-box">查询后会在这里生成换手率表格视图。</div>';
  els.table.innerHTML = '<div class="empty-box">查询后会在这里生成价格与命中明细。</div>';
}

function clearCharts() {
  if (window.Plotly) {
    Plotly.purge(els.chartClose);
    Plotly.purge(els.chartTor);
  }
  els.chartClose.innerHTML = "";
  els.chartTor.innerHTML = "";
}

function disableDownloads(disabled) {
  els.downloadCsv.disabled = disabled;
  els.exportXlsx.disabled = disabled;
}

function valueOf(input) {
  return input.value.trim();
}

function parseOptionalNumber(raw) {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeInputDate(value) {
  if (!value) return "";
  return value.replace(/-/g, "");
}

function toInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "-";
}

function formatInteger(value) {
  return Number.isFinite(value) ? Number(value).toLocaleString("zh-CN") : "-";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(Number(value) * 100).toFixed(2)}%` : "-";
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "-";
  const num = Number(value) * 100;
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function formatPercentRaw(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(2)}%` : "-";
}

function formatSignedPercentRaw(value) {
  if (!Number.isFinite(value)) return "-";
  const num = Number(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)} 个百分点`;
}

function toPercentNumber(value) {
  return Number.isFinite(value) ? Number(value) * 100 : "";
}

function withSign(value) {
  if (!Number.isFinite(value)) return "-";
  const num = Number(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}`;
}

function filenameBase() {
  const code = (lastPayload?.summary?.ts_code || valueOf(els.code) || "stock").trim().toUpperCase();
  const name = (lastPayload?.summary?.name_cn || "").trim();
  const end = lastPayload?.summary?.end || toYmd(new Date());
  const safeName = name.replace(/[\\/:*?"<>|]/g, "");
  return safeName ? `${safeName}_${code}_${end}` : `${code}_${end}`;
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

function isYmd(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const date = toDateObj(value);
  return toYmd(date) === value;
}

function toYmd(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, delta) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + delta);
  return next;
}

function toDateObj(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6)) - 1;
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(year, month, day);
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
      fillcolor: "rgba(23, 92, 211, 0.10)",
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
