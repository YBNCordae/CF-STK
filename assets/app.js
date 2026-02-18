let lastPayload = null;

document.getElementById("btn").onclick = async () => {
  const code = val("code");
  const start = val("start");
  const end = val("end");
  const buy = val("buy");

  const qs = new URLSearchParams({ code, start, end });
  if (buy) qs.set("buy", buy);

  setSummary("查询中...");
  document.getElementById("export").disabled = true;

  const r = await fetch(`/api/stock?${qs.toString()}`);
  const payload = await r.json();
  if (!payload.ok) {
    setSummary(`失败：${payload.msg || "unknown"}`);
    return;
  }

  lastPayload = payload;
  document.getElementById("export").disabled = false;
  renderSummary(payload.summary);
  renderChart(payload.items);
};

document.getElementById("export").onclick = () => {
  if (!lastPayload) return;
  exportExcel(lastPayload);
};

function val(id){ return document.getElementById(id).value.trim(); }

function setSummary(html){ document.getElementById("summary").innerHTML = html; }

function renderSummary(s){
  const cnDate = d => `${d.slice(0,4)}年${d.slice(4,6)}月${d.slice(6,8)}日`;
  const pct = x => x==null ? "-" : (x*100).toFixed(2) + "%";
  const num = x => x==null ? "-" : Number(x).toFixed(2);

  setSummary(`
    <div>区间最高：${num(s.high)}（${cnDate(s.high_date)}）</div>
    <div>区间最低：${num(s.low)}（${cnDate(s.low_date)}）</div>
    <div>最新收盘：${num(s.close)}（${cnDate(s.close_date)}）</div>
    <div>买入价：${s.buy ?? "-"} ｜差值：${num(s.diff_to_buy)} ｜收益：${pct(s.pct_to_buy)}</div>
  `);
}

function renderChart(items){
  const x = items.map(i => i.trade_date);
  const y = items.map(i => i.close);
  Plotly.newPlot("chart", [{ x, y, type:"scatter", mode:"lines", name:"收盘价" }], {
    margin: { l: 40, r: 20, t: 10, b: 40 },
    xaxis: { title: "日期" },
    yaxis: { title: "收盘价" }
  }, { displayModeBar: false });
}

function exportExcel(payload){
  const { summary, items } = payload;

  // 表1：汇总
  const sheet1 = [
    ["代码", summary.code],
    ["开始日期", summary.start],
    ["结束日期", summary.end],
    ["区间最高", summary.high],
    ["最高日期", summary.high_date],
    ["区间最低", summary.low],
    ["最低日期", summary.low_date],
    ["最新收盘", summary.close],
    ["收盘日期", summary.close_date],
    ["买入价", summary.buy ?? ""],
    ["与买入差值", summary.diff_to_buy ?? ""],
    ["与买入收益率", summary.pct_to_buy ?? ""],
  ];

  // 表2：明细
  const sheet2 = [
    ["日期","开盘","最高","最低","收盘","成交量","成交额"],
    ...items.map(i => [i.trade_date, i.open, i.high, i.low, i.close, i.vol, i.amount])
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), "汇总");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2), "明细");

  const filename = `${summary.code}_${summary.start}-${summary.end}.xlsx`;
  XLSX.writeFile(wb, filename);
}
