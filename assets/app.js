let lastPayload = null;

initDefaults();
bindModeSwitch();
bindPriceStepRefresh();

document.getElementById("btn").onclick = runQuery;
document.getElementById("downloadCsv").onclick = downloadCsv;
document.getElementById("exportXlsx").onclick = exportXlsx;

function byId(id) {
  return document.getElementById(id);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function f2(v) {
  const n = num(v);
  return n == null ? "-" : n.toFixed(2);
}

function pct(v) {
  const n = num(v);
  return n == null ? "-" : (n * 100).toFixed(2) + "%";
}

function pctRaw(v) {
  const n = num(v);
  return n == null ? "-" : n.toFixed(2) + "%";
}

function signedF2(v) {
  const n = num(v);
  return n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSummary(summary, items, ts_code, mode) {
  const s = { ...(summary || {}) };
  const rows = Array.isArray(items) ? items : [];

  s.ts_code = s.ts_code || ts_code || "";
  s.mode = s.mode || mode || "";
  s.start = s.start ?? s.start_date ?? (rows[0]?.trade_date || "");
  s.end = s.end ?? s.end_date ?? (rows[rows.length - 1]?.trade_date || "");
  s.count = s.count ?? rows.length ?? 0;

  s.today_close = s.today_close ?? s.close_latest ?? null;
  s.mean = s.mean ?? s.close_mean ?? null;
  s.high = s.high ?? s.close_max ?? null;
  s.low = s.low ?? s.close_min ?? null;

  s.turnover_latest = s.turnover_latest ?? s.tor_latest ?? null;
  s.turnover_mean = s.turnover_mean ?? s.tor_mean ?? null;
  s.turnover_max = s.turnover_max ?? s.tor_max ?? null;
  s.turnover_min = s.turnover_min ?? s.tor_min ?? null;

  [
    "today_close",
    "mean",
    "high",
    "low",
    "turnover_latest",
    "turnover_mean",
    "turnover_max",
    "turnover_min",
    "dev_vs_mean",
    "amplitude",
    "rise_from_low",
    "drawdown_from_high",
    "pos_pct",
  ].forEach(key => {
    const value = num(s[key]);
    if (value != null) s[key] = value;
  });

  if (rows.length) {
    let hi = -Infinity;
    let lo = Infinity;
    let hiDates = [];
    let loDates = [];
    let tMax = -Infinity;
    let tMin = Infinity;
    let tMaxDates = [];
    let tMinDates = [];

    for (const r of rows) {
      const close = num(r.close);
      if (close != null) {
        if (close > hi) {
          hi = close;
          hiDates = [r.trade_date];
        } else if (close === hi) {
          hiDates.push(r.trade_date);
        }

        if (close < lo) {
          lo = close;
          loDates = [r.trade_date];
        } else if (close === lo) {
          loDates.push(r.trade_date);
        }
      }

      const tor = num(r.turnover_rate);
      if (tor != null) {
        if (tor > tMax) {
          tMax = tor;
          tMaxDates = [r.trade_date];
        } else if (tor === tMax) {
          tMaxDates.push(r.trade_date);
        }

        if (tor < tMin) {
          tMin = tor;
          tMinDates = [r.trade_date];
        } else if (tor === tMin) {
          tMinDates.push(r.trade_date);
        }
      }
    }

    if (!Number.isFinite(s.high) && hiDates.length) s.high = hi;
    if (!Number.isFinite(s.low) && loDates.length) s.low = lo;
    if (!Number.isFinite(s.turnover_max) && tMaxDates.length) s.turnover_max = tMax;
    if (!Number.isFinite(s.turnover_min) && tMinDates.length) s.turnover_min = tMin;

    s.high_date_short = s.high_date_short || formatDateList(hiDates);
    s.low_date_short = s.low_date_short || formatDateList(loDates);
    s.turnover_max_date_short = s.turnover_max_date_short || formatDateList(tMaxDates);
    s.turnover_min_date_short = s.turnover_min_date_short || formatDateList(tMinDates);
  }

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
  if (Number.isFinite(s.today_close) && Number.isFinite(s.high) && Number.isFinite(s.low) && !Number.isFinite(s.pos_pct) && (s.high - s.low) !== 0) {
    s.pos_pct = ((s.today_close - s.low) / (s.high - s.low)) * 100;
  }

  s.name_cn = s.name_cn || "";
  s.high_date_short = s.high_date_short || "-";
  s.low_date_short = s.low_date_short || "-";
  s.turnover_max_date_short = s.turnover_max_date_short || "-";
  s.turnover_min_date_short = s.turnover_min_date_short || "-";

  return s;
}

function initDefaults() {
  const today = new Date();
  byId("start").value = toYmd(addDays(today, -180));
  byId("end").value = toYmd(today);
}

function bindModeSwitch() {
  const radios = [...document.querySelectorAll("input[name=mode]")];
  radios.forEach(r => r.addEventListener("change", () => {
    const mode = getMode();
    byId("nBox").classList.toggle("hidden", mode !== "n");
    byId("rangeBox").classList.toggle("hidden", mode !== "range");
  }));
}

function bindPriceStepRefresh() {
  const input = byId("priceStep");
  if (!input) return;
  input.addEventListener("change", () => {
    if (lastPayload?.items?.length) renderPriceBuckets(lastPayload.items);
  });
}

function getMode() {
  return document.querySelector("input[name=mode]:checked").value;
}

async function runQuery() {
  clearReport();
  setSummary("查询中...");
  setBusy(true);
  disableDownloads(true);

  try {
    const code = val("code");
    if (!code) throw new Error("请输入股票代码");

    const mode = getMode();
    let start;
    let end;
    let n;

    if (mode === "n") {
      n = Math.max(1, Math.min(2000, Math.floor(num(val("n")) || 60)));
      const today = new Date();
      end = toYmd(today);
      start = toYmd(addDays(today, -900));
    } else {
      start = val("start");
      end = val("end");
      if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) {
        throw new Error("自定义区间请填写 YYYYMMDD 格式的开始和结束日期");
      }
      if (start > end) throw new Error("开始日期不能晚于结束日期");
    }

    const qs = new URLSearchParams({ code, mode, start, end });
    if (mode === "n") qs.set("n", String(n));

    const r = await fetch(`/api/stock?${qs.toString()}`);
    const text = await r.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`接口返回不是 JSON（HTTP ${r.status}）：${text.slice(0, 200)}`);
    }

    if (!r.ok || !payload.ok) {
      throw new Error(payload.msg || `HTTP ${r.status}`);
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const summary = normalizeSummary(payload.summary, items, payload.ts_code, payload.mode);
    summary.name_cn = summary.name_cn || payload.name_cn || "";
    summary.ts_code = summary.ts_code || payload.ts_code || "";
    summary.mode = summary.mode || payload.mode || "";

    lastPayload = { ...payload, items, summary };
    disableDownloads(false);

    renderSummary(summary, getBuyInfo());
    renderPriceBuckets(items);
    renderCharts(items, summary);
    renderTable(items);
  } catch (e) {
    console.error(e);
    lastPayload = null;
    setSummary(`<div class="error">失败：${escapeHtml(e.message || e)}</div>`);
    setEmpty(byId("priceBuckets"), "查询成功后展示价格档位。");
    disableDownloads(true);
  } finally {
    setBusy(false);
  }
}

function getBuyInfo() {
  const buy = num(val("buy"));
  const shares = num(val("shares"));
  return {
    buy: buy != null && buy > 0 ? buy : null,
    shares: shares != null && shares > 0 ? shares : null,
  };
}

function renderSummary(s, buyInfo) {
  if (!s) return setSummary("没有数据");

  const todayClose = num(s.today_close);
  const buy = buyInfo.buy;
  let buyLine = "";

  if (buy) {
    if (todayClose == null) {
      buyLine = `
        <div class="krow">
          <div>我的买入价：<b>${f2(buy)}</b></div>
          <div>盈亏：<b>-</b></div>
        </div>
      `;
    } else {
      const diff = todayClose - buy;
      const shares = buyInfo.shares;
      buyLine = `
        <div class="krow">
          <div>我的买入价：<b>${f2(buy)}</b></div>
          <div>每股盈亏：<b>${signedF2(diff)}</b></div>
          <div>收益率：<b>${pct(diff / buy)}</b></div>
          <div>浮动盈亏（元）：<b>${shares ? signedF2(diff * shares) : "-"}</b></div>
        </div>
      `;
    }
  }

  const pos = Math.max(0, Math.min(100, num(s.pos_pct) ?? 0));

  setSummary(`
    <div class="krow">
      <div>股票：<b>${escapeHtml(s.name_cn || "-")}（${escapeHtml(s.ts_code || "-")}）</b></div>
      <div>截至：<b>${escapeHtml(cnDate(s.end))}</b></div>
      <div>今日收盘价：<b>${f2(s.today_close)}</b></div>
      <div>区间均值：<b>${f2(s.mean)}</b>（${pct(s.dev_vs_mean)} 相对均值）</div>
      <div>区间振幅：<b>${pct(s.amplitude)}</b></div>
    </div>

    <div class="krow">
      <div>区间最高价：<b>${f2(s.high)}</b>（${escapeHtml(s.high_date_short)}）</div>
      <div>区间最低价：<b>${f2(s.low)}</b>（${escapeHtml(s.low_date_short)}）</div>
      <div>今日相对最低涨幅：<b>${pct(s.rise_from_low)}</b></div>
      <div>今日相对最高回撤：<b>${pct(s.drawdown_from_high)}</b></div>
    </div>

    <div class="krow">
      <div>换手率（最新）：<b>${pctRaw(s.turnover_latest)}</b></div>
      <div>换手率（均值）：<b>${pctRaw(s.turnover_mean)}</b></div>
      <div>换手率（最高）：<b>${pctRaw(s.turnover_max)}</b>（${escapeHtml(s.turnover_max_date_short)}）</div>
      <div>换手率（最低）：<b>${pctRaw(s.turnover_min)}</b>（${escapeHtml(s.turnover_min_date_short)}）</div>
    </div>

    <div class="krow krow-progress">
      <div>区间位置：<b>${pos.toFixed(1)}%</b></div>
      <div class="progress"><div class="bar" style="width:${pos}%;"></div></div>
      <div class="muted">0% 靠近最低；100% 靠近最高</div>
    </div>

    ${buyLine}
    <div class="muted">说明：本页“今日”使用区间内最新交易日收盘价（非盘中实时）。</div>
  `);
}

function buildPriceBuckets(items, step) {
  const rows = (Array.isArray(items) ? items : [])
    .map(r => ({ trade_date: r.trade_date, close: num(r.close) }))
    .filter(r => r.trade_date && r.close != null);

  if (!rows.length || step == null || step <= 0) return { buckets: [], rows, low: null, high: null };

  const closes = rows.map(r => r.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const eps = 1e-9;
  const buckets = [];

  if (Math.abs(high - low) <= eps) {
    return {
      rows,
      low,
      high,
      buckets: [{
        rangeText: `收盘价 = ${f2(high)}（区间上限）`,
        hits: rows.filter(r => Math.abs(r.close - high) <= eps),
        isLast: true,
      }],
    };
  }

  let lower = low;
  let guard = 0;

  while (lower < high - eps && guard < 5000) {
    const upper = Math.min(roundPrice(lower + step), high);
    if (upper <= lower + eps) break;

    const hits = rows.filter(r => r.close >= lower - eps && r.close < upper - eps);
    buckets.push({
      rangeText: `${f2(lower)} <= 收盘价 < ${f2(upper)}`,
      hits,
      isLast: false,
    });

    lower = upper;
    guard += 1;
  }

  buckets.push({
    rangeText: `收盘价 = ${f2(high)}（区间上限）`,
    hits: rows.filter(r => Math.abs(r.close - high) <= eps),
    isLast: true,
  });

  return { rows, low, high, buckets };
}

function renderPriceBuckets(items) {
  const el = byId("priceBuckets");
  if (!el) return;

  const step = getPriceStep();
  if (step == null) {
    setEmpty(el, "请输入大于 0 的价格档位步长。");
    return;
  }

  const { buckets, rows, low, high } = buildPriceBuckets(items, step);
  if (!rows.length) {
    setEmpty(el, "暂无可统计的收盘价数据。");
    return;
  }

  if (buckets.length > 800) {
    setEmpty(el, "当前步长过小，生成的档位太多；请调大价格档位步长后再查看。");
    return;
  }

  const hitCount = buckets.reduce((sum, bucket) => sum + bucket.hits.length, 0);
  const rowsHtml = buckets.map((bucket, index) => `
    <tr class="${bucket.isLast ? "bucket-last" : ""}">
      <td>${index + 1}</td>
      <td>${escapeHtml(bucket.rangeText)}</td>
      <td>${bucket.hits.length}</td>
      <td>${renderHitList(bucket.hits)}</td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="bucket-meta">
      <span>区间下限：<b>${f2(low)}</b></span>
      <span>区间上限：<b>${f2(high)}</b></span>
      <span>步长：<b>${f2(step)}</b></span>
      <span>命中合计：<b>${hitCount}</b></span>
    </div>
    <div class="muted">普通档位按“左闭右开”统计，最后一档仅统计收盘价恰好等于区间上限的交易日。</div>
    <div class="table-wrap">
      <table class="bucket-table">
        <thead>
          <tr>
            <th>档位</th>
            <th>覆盖价格范围</th>
            <th>命中次数</th>
            <th>交易日期与收盘价</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderHitList(hits) {
  if (!hits.length) return `<span class="muted">-</span>`;
  return `
    <div class="hit-list">
      ${hits.map(hit => `
        <span class="hit-pill">${escapeHtml(cnDate(hit.trade_date))}<b>${f2(hit.close)}</b></span>
      `).join("")}
    </div>
  `;
}

function renderCharts(items, s) {
  if (!items?.length) return;
  if (!window.Plotly) {
    setEmpty(byId("chartClose"), "图表库未加载，暂时无法绘制走势图。");
    setEmpty(byId("chartTor"), "图表库未加载，暂时无法绘制换手率图。");
    return;
  }

  const x = items.map(i => toDateObj(i.trade_date));
  const yAll = items.map(i => num(i.close));
  const y = yAll.filter(v => v != null);
  if (!y.length) return;

  const high = Number.isFinite(s?.high) ? s.high : Math.max(...y);
  const low = Number.isFinite(s?.low) ? s.low : Math.min(...y);
  const mean = Number.isFinite(s?.mean) ? s.mean : (y.reduce((a, b) => a + b, 0) / y.length);

  const highIdx0 = yAll.indexOf(high);
  const lowIdx0 = yAll.indexOf(low);
  const highIdx = highIdx0 >= 0 ? highIdx0 : (x.length - 1);
  const lowIdx = lowIdx0 >= 0 ? lowIdx0 : (x.length - 1);

  const tracesClose = [
    {
      x,
      y: yAll,
      type: "scatter",
      mode: "lines",
      name: "收盘价",
      hovertemplate: "日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
    {
      x: [x[x.length - 1]],
      y: [yAll[yAll.length - 1]],
      type: "scatter",
      mode: "markers",
      name: "最新收盘",
      hovertemplate: "最新收盘<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
    {
      x: [x[highIdx]],
      y: [high],
      type: "scatter",
      mode: "markers+text",
      name: "区间最高",
      text: [`最高 ${f2(high)}`],
      textposition: "top center",
      hovertemplate: "区间最高<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
    {
      x: [x[lowIdx]],
      y: [low],
      type: "scatter",
      mode: "markers+text",
      name: "区间最低",
      text: [`最低 ${f2(low)}`],
      textposition: "bottom center",
      hovertemplate: "区间最低<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>",
    },
  ];

  const layoutClose = {
    title: `${s?.ts_code || ""} | 区间 ${cnDate(s?.start || s?.start_date || "")} ~ ${cnDate(s?.end || s?.end_date || "")} | 共 ${s?.count ?? items.length} 个交易日`,
    margin: { l: 48, r: 88, t: 60, b: 44 },
    xaxis: { title: "日期" },
    yaxis: { title: "收盘价" },
    hovermode: "x unified",
    shapes: [
      {
        type: "rect",
        xref: "x",
        yref: "y",
        x0: x[0],
        x1: x[x.length - 1],
        y0: low,
        y1: high,
        fillcolor: "rgba(0,0,0,0.05)",
        line: { width: 0 },
        layer: "below",
      },
      ...[mean, high, low].map(v => ({
        type: "line",
        xref: "x",
        yref: "y",
        x0: x[0],
        x1: x[x.length - 1],
        y0: v,
        y1: v,
        line: { width: 1, dash: "dot" },
      })),
    ],
    annotations: [
      { x: x[x.length - 1], y: mean, xref: "x", yref: "y", text: `均值：${f2(mean)}`, showarrow: false, xanchor: "left" },
      { x: x[x.length - 1], y: high, xref: "x", yref: "y", text: `最高：${f2(high)}`, showarrow: false, xanchor: "left" },
      { x: x[x.length - 1], y: low, xref: "x", yref: "y", text: `最低：${f2(low)}`, showarrow: false, xanchor: "left" },
    ],
    legend: { orientation: "h", y: 1.12, x: 1, xanchor: "right" },
  };

  Plotly.newPlot("chartClose", tracesClose, layoutClose, { displayModeBar: false, responsive: true });

  Plotly.newPlot("chartTor", [
    {
      x,
      y: items.map(i => i.turnover_rate == null ? null : num(i.turnover_rate)),
      type: "bar",
      name: "换手率（%）",
      hovertemplate: "日期=%{x|%Y年%m月%d日}<br>换手率=%{y:.2f}%<extra></extra>",
    },
  ], {
    margin: { l: 48, r: 24, t: 10, b: 44 },
    xaxis: { title: "日期" },
    yaxis: { title: "换手率（%）" },
  }, { displayModeBar: false, responsive: true });
}

function renderTable(items) {
  const rows = (Array.isArray(items) ? items : []).slice().reverse();
  if (!rows.length) {
    setEmpty(byId("table"), "暂无区间数据。");
    return;
  }

  byId("table").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>日期</th><th>收盘价</th><th>换手率（%）</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(cnDate(r.trade_date))}</td>
              <td>${f2(r.close)}</td>
              <td>${r.turnover_rate == null ? "-" : f2(r.turnover_rate)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function downloadCsv() {
  if (!lastPayload?.items?.length) return;

  const header = ["日期", "收盘价", "换手率(%)"];
  const lines = [header.join(",")];

  for (const r of lastPayload.items) {
    lines.push([
      csvCell(cnDate(r.trade_date)),
      f2(r.close),
      r.turnover_rate == null ? "" : f2(r.turnover_rate),
    ].join(","));
  }

  const csv = "\ufeff" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filenameBase() + ".csv");
}

function exportXlsx() {
  if (!lastPayload?.items?.length || !lastPayload?.summary) return;

  const s = lastPayload.summary;
  const items = lastPayload.items;
  const buyInfo = getBuyInfo();

  const rows = [
    ["股票代码", s.ts_code],
    ["股票名字", s.name_cn],
    ["区间选择", s.mode === "n" ? "最近N个交易日" : "自定义起止日期"],
    ["区间开始", cnDate(s.start)],
    ["区间结束（最新交易日）", cnDate(s.end)],
    ["交易日数量", s.count],
    ["今日收盘价", s.today_close],
    ["区间均值", s.mean],
    ["区间最高价", s.high],
    ["最高价出现", s.high_date_short],
    ["区间最低价", s.low],
    ["最低价出现", s.low_date_short],
    ["今日相对最低涨幅(%)", num(s.rise_from_low) == null ? null : s.rise_from_low * 100],
    ["今日相对最高回撤(%)", num(s.drawdown_from_high) == null ? null : s.drawdown_from_high * 100],
    ["区间振幅(%)", num(s.amplitude) == null ? null : s.amplitude * 100],
    ["区间位置(%)", s.pos_pct],
    ["换手率（最新，%）", s.turnover_latest],
    ["换手率（均值，%）", s.turnover_mean],
    ["换手率（最高，%）", s.turnover_max],
    ["换手率最高出现", s.turnover_max_date_short],
    ["换手率（最低，%）", s.turnover_min],
    ["换手率最低出现", s.turnover_min_date_short],
    ["价格档位步长", getPriceStep()],
  ];

  if (buyInfo.buy && num(s.today_close) != null) {
    const diff = s.today_close - buyInfo.buy;
    rows.push(["我的买入价", buyInfo.buy]);
    rows.push(["每股盈亏", diff]);
    rows.push(["收益率(%)", diff / buyInfo.buy * 100]);
    if (buyInfo.shares) rows.push(["浮动盈亏(元)", diff * buyInfo.shares]);
  }

  const sheet2 = [
    ["日期", "收盘价", "换手率（%）"],
    ...items.map(r => [
      cnDate(r.trade_date),
      num(r.close),
      r.turnover_rate == null ? null : num(r.turnover_rate),
    ]),
  ];

  const buckets = buildPriceBuckets(items, getPriceStep()).buckets;
  const sheet3 = [
    ["档位", "覆盖价格范围", "命中次数", "交易日期与收盘价"],
    ...buckets.map((bucket, index) => [
      index + 1,
      bucket.rangeText,
      bucket.hits.length,
      bucket.hits.map(hit => `${cnDate(hit.trade_date)} ${f2(hit.close)}`).join("；"),
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "查询概览");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2), "区间数据");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet3), "价格档位");

  XLSX.writeFile(wb, filenameBase() + "_查询信息.xlsx");
}

function getPriceStep() {
  const step = num(val("priceStep"));
  return step != null && step > 0 ? step : null;
}

function filenameBase() {
  const code = (val("code") || "stock").trim().toUpperCase();
  const name = (lastPayload?.summary?.name_cn || lastPayload?.name_cn || "").trim();
  const today = toYmd(new Date());
  const safeName = name.replace(/[\\/:*?"<>|]/g, "");
  return safeName ? `${safeName}_${code}_${today}` : `${code}_${today}`;
}

function clearReport() {
  setSummary("");
  setEmpty(byId("priceBuckets"), "查询成功后展示价格档位。");
  byId("table").innerHTML = "";

  if (window.Plotly) {
    Plotly.purge("chartClose");
    Plotly.purge("chartTor");
  } else {
    byId("chartClose").innerHTML = "";
    byId("chartTor").innerHTML = "";
  }
}

function disableDownloads(disabled) {
  byId("downloadCsv").disabled = disabled;
  byId("exportXlsx").disabled = disabled;
}

function setBusy(busy) {
  byId("btn").disabled = busy;
}

function setSummary(html) {
  byId("summary").innerHTML = html;
}

function setEmpty(el, message) {
  if (!el) return;
  el.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function val(id) {
  return byId(id).value.trim();
}

function formatDateList(dates) {
  const clean = [...new Set((dates || []).filter(Boolean))];
  return clean.length ? clean.map(cnDate).join("、") : "-";
}

function roundPrice(v) {
  return Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function addDays(d, delta) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + delta);
  return x;
}

function toDateObj(yyyymmdd) {
  const s = String(yyyymmdd || "");
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  return new Date(y, m, d);
}

function cnDate(yyyymmdd) {
  const s = String(yyyymmdd || "");
  if (!/^\d{8}$/.test(s)) return s || "-";
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  return `${y}年${m}月${d}日`;
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
