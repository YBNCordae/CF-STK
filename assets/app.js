let lastPayload = null;

initDefaults();
bindModeSwitch();

document.getElementById("btn").onclick = runQuery;
document.getElementById("downloadCsv").onclick = downloadCsv;
document.getElementById("exportXlsx").onclick = exportXlsx;

function f2(v) {
  return Number.isFinite(v) ? v.toFixed(2) : "-";
}


function initDefaults() {
  // 默认 end = 今天（按浏览器本地），start/end 仅用于自定义模式；N模式会在 runQuery 时自动算范围
  const today = new Date();
  const end = toYmd(today);
  const start = toYmd(addDays(today, -180));
  document.getElementById("start").value = start;
  document.getElementById("end").value = end;
}

function bindModeSwitch() {
  const radios = [...document.querySelectorAll("input[name=mode]")];
  radios.forEach(r => r.addEventListener("change", () => {
    const mode = getMode();
    document.getElementById("nBox").classList.toggle("hidden", mode !== "n");
    document.getElementById("rangeBox").classList.toggle("hidden", mode !== "range");
  }));
}

function getMode() {
  return document.querySelector("input[name=mode]:checked").value;
}

async function runQuery() {
  setSummary("查询中…");
  disableDownloads(true);

  try {
    const code = val("code");
    const mode = getMode();
    let start, end, n;

    if (mode === "n") {
      n = Number(val("n") || "60");
      const today = new Date();
      end = toYmd(today);
      start = toYmd(addDays(today, -900));
    } else {
      start = val("start");
      end = val("end");
    }

    const qs = new URLSearchParams({ code, mode, start, end });
    if (mode === "n") qs.set("n", String(n));

    const r = await fetch(`/api/stock?${qs.toString()}`);

    // ✅ 先读 text，再尝试 parse，避免 r.json() 直接抛导致 UI 卡死
    const text = await r.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`接口返回不是JSON（HTTP ${r.status}）：` + text.slice(0, 200));
    }

    if (!r.ok || !payload.ok) {
      throw new Error(payload.msg || `HTTP ${r.status}`);
    }

    lastPayload = payload;
    disableDownloads(false);
    renderSummary(payload.summary, getBuyInfo());
    renderCharts(payload.items, payload.summary);
    renderTable(payload.items);
  } catch (e) {
    console.error(e);
    setSummary(`失败：${e.message || e}`);
    lastPayload = null;
    disableDownloads(true);
  }
}


function getBuyInfo() {
  const buy = Number(val("buy") || "0");
  const shares = Number(val("shares") || "0");
  return {
    buy: Number.isFinite(buy) && buy > 0 ? buy : null,
    shares: Number.isFinite(shares) && shares > 0 ? shares : null,
  };
}

function renderSummary(s, buyInfo) {
  if (!s) return setSummary("没有数据");

  const cn = cnDate;
  const f2 = x => (x == null || !Number.isFinite(x)) ? "-" : Number(x).toFixed(2);
  const pct = x => (x == null || !Number.isFinite(x)) ? "-" : (x * 100).toFixed(2) + "%";
  const pctRaw = x => (x == null || !Number.isFinite(x)) ? "-" : Number(x).toFixed(2) + "%";

  const todayClose = s.today_close;
  const buy = buyInfo.buy;
  let buyLine = "";
  if (buy) {
    const diff = todayClose - buy;
    const ret = diff / buy;
    const shares = buyInfo.shares;
    buyLine = `
      <div class="krow">
        <div>我的买入价：<b>${f2(buy)}</b></div>
        <div>每股盈亏：<b>${diff >= 0 ? "+" : ""}${f2(diff)}</b></div>
        <div>收益率：<b>${pct(ret)}</b></div>
        <div>浮动盈亏（元）：<b>${shares ? ((diff * shares) >= 0 ? "+" : "") + f2(diff * shares) : "-"}</b></div>
      </div>
    `;
  }

  const pos = Math.max(0, Math.min(100, s.pos_pct || 0));

  setSummary(`
    <div class="krow">
      <div>截至：<b>${cn(s.end)}</b></div>
      <div>今日收盘价：<b>${f2(s.today_close)}</b></div>
      <div>区间均值：<b>${f2(s.mean)}</b>（${pct(s.dev_vs_mean)} 相对均值）</div>
      <div>区间振幅：<b>${pct(s.amplitude)}</b></div>
    </div>

    <div class="krow">
      <div>区间最高价：<b>${f2(s.high)}</b>（${s.high_date_short}）</div>
      <div>区间最低价：<b>${f2(s.low)}</b>（${s.low_date_short}）</div>
      <div>今日相对最低涨幅：<b>${pct(s.rise_from_low)}</b></div>
      <div>今日相对最高回撤：<b>${pct(s.drawdown_from_high)}</b></div>
    </div>

    <div class="krow">
      <div>换手率（最新）：<b>${pctRaw(s.turnover_latest)}</b></div>
      <div>换手率（均值）：<b>${pctRaw(s.turnover_mean)}</b></div>
      <div>换手率（最高）：<b>${pctRaw(s.turnover_max)}</b>（${s.turnover_max_date_short || "-"}）</div>
      <div>换手率（最低）：<b>${pctRaw(s.turnover_min)}</b>（${s.turnover_min_date_short || "-"}）</div>
    </div>

    <div class="krow">
      <div>区间位置：<b>${pos.toFixed(1)}%</b></div>
      <div class="progress"><div class="bar" style="width:${pos}%;"></div></div>
      <div class="muted">0% 靠近最低；100% 靠近最高</div>
    </div>

    ${buyLine}
    <div class="muted">说明：本页“今日”使用区间内最新交易日收盘价（非盘中实时）。</div>
  `);
}

function renderCharts(items, s) {
  if (!items || !items.length) return;

  const x = items.map(i => toDateObj(i.trade_date));
  const y = items.map(i => i.close);

  const high = s.high;
  const low = s.low;
  const mean = s.mean;

  const highIdx = y.indexOf(high);
  const lowIdx = y.indexOf(low);

  // 收盘价图
  const tracesClose = [
    { x, y, type: "scatter", mode: "lines", name: "收盘价",
      hovertemplate: "日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>" },
    { x: [x[x.length-1]], y: [y[y.length-1]], type:"scatter", mode:"markers", name:"最新收盘",
      hovertemplate: "最新收盘<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>" },
    { x: [x[highIdx]], y: [high], type:"scatter", mode:"markers+text", name:"区间最高",
      text:[`最高 ${high.f2(2)}`], textposition:"top center",
      hovertemplate: "区间最高<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>" },
    { x: [x[lowIdx]], y: [low], type:"scatter", mode:"markers+text", name:"区间最低",
      text:[`最低 ${low.f2(2)}`], textposition:"bottom center",
      hovertemplate: "区间最低<br>日期=%{x|%Y年%m月%d日}<br>收盘=%{y:.2f}<extra></extra>" },
  ];

  const layoutClose = {
    title: `${s.ts_code}｜区间 ${cnDate(s.start)} ~ ${cnDate(s.end)}｜共 ${s.count} 个交易日`,
    margin: { l: 40, r: 20, t: 60, b: 40 },
    xaxis: { title: "日期" },
    yaxis: { title: "收盘价" },
    hovermode: "x unified",
    shapes: [
      // 区间范围带
      { type:"rect", xref:"x", yref:"y", x0:x[0], x1:x[x.length-1], y0:low, y1:high,
        fillcolor:"rgba(0,0,0,0.05)", line:{ width:0 }, layer:"below" },
      // 均值/高/低 线
      ...[mean, high, low].map(v => ({
        type:"line", xref:"x", yref:"y", x0:x[0], x1:x[x.length-1], y0:v, y1:v,
        line:{ width:1, dash:"dot" }
      }))
    ],
    annotations: [
      { x:x[x.length-1], y:mean, xref:"x", yref:"y", text:`均值：${mean.f2(2)}`, showarrow:false, xanchor:"left" },
      { x:x[x.length-1], y:high, xref:"x", yref:"y", text:`最高：${high.f2(2)}`, showarrow:false, xanchor:"left" },
      { x:x[x.length-1], y:low,  xref:"x", yref:"y", text:`最低：${low.f2(2)}`,  showarrow:false, xanchor:"left" },
    ],
    legend: { orientation:"h", y:1.12, x:1, xanchor:"right" }
  };

  Plotly.newPlot("chartClose", tracesClose, layoutClose, { displayModeBar: false, responsive: true });

  // 换手率图（柱状）
  const x2 = x;
  const tor = items.map(i => (i.turnover_rate == null ? null : i.turnover_rate)); // 单位：%
  Plotly.newPlot("chartTor", [
    { x: x2, y: tor, type:"bar", name:"换手率（%）",
      hovertemplate: "日期=%{x|%Y年%m月%d日}<br>换手率=%{y:.2f}%<extra></extra>" }
  ], {
    margin: { l: 40, r: 20, t: 10, b: 40 },
    xaxis: { title: "日期" },
    yaxis: { title: "换手率（%）" },
  }, { displayModeBar: false, responsive: true });
}

function renderTable(items) {
  const rows = items.slice().reverse(); // 最近在上
  const html = `
    <table>
      <thead><tr><th>日期</th><th>收盘价</th><th>换手率（%）</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${cnDate(r.trade_date)}</td>
            <td>${Number(r.close).toFixed(2)}</td>
            <td>${r.turnover_rate == null ? "-" : Number(r.turnover_rate).toFixed(2)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  document.getElementById("table").innerHTML = html;
}

function downloadCsv() {
  if (!lastPayload?.items?.length) return;
  const items = lastPayload.items;

  const header = ["日期", "收盘价", "换手率(%)"];
  const lines = [header.join(",")];

  for (const r of items) {
    lines.push([
      cnDate(r.trade_date),
      Number(r.close).toFixed(2),
      r.turnover_rate == null ? "" : Number(r.turnover_rate).toFixed(2),
    ].join(","));
  }

  // UTF-8 BOM，Excel 打开不乱码
  const csv = "\ufeff" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filenameBase() + ".csv");
}

function exportXlsx() {
  if (!lastPayload?.items?.length || !lastPayload?.summary) return;

  const s = lastPayload.summary;
  const items = lastPayload.items;
  const buyInfo = getBuyInfo();

  // ====== Sheet1：查询概览 ======
  const rows = [
    ["股票代码", s.ts_code],
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
    ["今日相对最低涨幅(%)", (s.rise_from_low * 100)],
    ["今日相对最高回撤(%)", (s.drawdown_from_high * 100)],
    ["区间振幅(%)", (s.amplitude * 100)],
    ["区间位置(%)", s.pos_pct],

    // ===== 新增：换手率 =====
    ["换手率（最新，%）", s.turnover_latest],
    ["换手率（均值，%）", s.turnover_mean],
    ["换手率（最高，%）", s.turnover_max],
    ["换手率最高出现", s.turnover_max_date_short],
    ["换手率（最低，%）", s.turnover_min],
    ["换手率最低出现", s.turnover_min_date_short],
  ];

  if (buyInfo.buy) {
    const diff = s.today_close - buyInfo.buy;
    const ret = diff / buyInfo.buy;
    rows.push(["我的买入价", buyInfo.buy]);
    rows.push(["每股盈亏", diff]);
    rows.push(["收益率(%)", ret * 100]);
    if (buyInfo.shares) rows.push(["浮动盈亏(元)", diff * buyInfo.shares]);
  }

  // ====== Sheet2：区间数据 ======
  const sheet2 = [
    ["日期", "收盘价", "换手率（%）"],
    ...items.map(r => [
      cnDate(r.trade_date),
      Number(r.close).toFixed(2),
      r.turnover_rate == null ? "" : Number(r.turnover_rate).toFixed(2),
    ])
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "查询概览");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2), "区间数据");

  XLSX.writeFile(wb, filenameBase() + "_查询信息.xlsx");
}

function filenameBase() {
  const code = (val("code") || "stock").trim().toUpperCase();
  const today = toYmd(new Date());
  return `${code}_${today}`;
}

function disableDownloads(disabled) {
  document.getElementById("downloadCsv").disabled = disabled;
  document.getElementById("exportXlsx").disabled = disabled;
}

function setSummary(html) {
  document.getElementById("summary").innerHTML = html;
}

function val(id) { return document.getElementById(id).value.trim(); }

// ===== date helpers =====
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
  const y = Number(yyyymmdd.slice(0,4));
  const m = Number(yyyymmdd.slice(4,6)) - 1;
  const d = Number(yyyymmdd.slice(6,8));
  return new Date(y, m, d);
}
function cnDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const y = Number(yyyymmdd.slice(0,4));
  const m = Number(yyyymmdd.slice(4,6));
  const d = Number(yyyymmdd.slice(6,8));
  return `${y}年${m}月${d}日`;
}

// ===== download helper =====
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
