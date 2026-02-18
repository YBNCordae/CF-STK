export default async function onRequest(context) {
  try {
    const u = new URL(context.request.url);
    const sp = u.searchParams;

    const rawCode = (sp.get("code") || "").trim();
    const mode = (sp.get("mode") || "n").trim();

    if (!rawCode) return json({ ok: false, msg: "需要 code 参数" }, 400);

    // 统一成 ts_code 形态：600519.SH / 000001.SZ
    const ts_code = normalizeTsCode(rawCode);
    let start = (sp.get("start") || sp.get("start_date") || "").trim();
    let end = (sp.get("end") || sp.get("end_date") || "").trim();
    let n = (sp.get("n") || "").trim();

    // mode=n：允许不传 start/end，后端自动补齐
    if (mode === "n") {
      if (!n) n = "60";
      if (!end) end = ymd(new Date());
      if (!start) start = ymd(addDays(new Date(), -900));
    } else if (mode === "range") {
      if (!start || !end) return json({ ok: false, msg: "mode=range 需要 start/end" }, 400);
    } else {
      return json({ ok: false, msg: "mode 只能是 n 或 range" }, 400);
    }

    // 拉取日K（包含收盘价 & 换手率）
    const itemsAll = await fetchKlineEastmoney(ts_code, start, end);

    if (!itemsAll.length) {
      return json({ ok: false, msg: "数据为空：请检查代码/日期范围" }, 200);
    }

    // 如果是最近 N 个交易日，截取末尾 N 条
    let items = itemsAll;
    if (mode === "n") {
      const nn = Math.max(1, Math.min(2000, parseInt(n, 10) || 60));
      items = itemsAll.slice(-nn);
    }


    const summary = buildSummary(items);
    const name_cn = await fetchCnNameEastmoney(ts_code);
    summary.name_cn = name_cn;

    return json({
      ok: true,
      ts_code,
      name_cn, // 顶层也带一份，前端好取
      mode,
      start,
      end,
      n: mode === "n" ? String(items.length) : null,
      summary,
      items
    }, 200);
  } catch (e) {
    return json({ ok: false, msg: String(e?.message || e) }, 500);
  }
}

/** ----------------- Eastmoney Kline ----------------- **/

function toEastmoneySecid(ts_code) {
  // ts_code: "600519.SH" / "000001.SZ" / "430047.BJ"
  const [code, ex] = ts_code.split(".");
  const market = ex === "SH" ? "1" : "0"; // 常用映射：沪=1，深/北=0
  return `${market}.${code}`;
}

async function fetchKlineEastmoney(ts_code, beg, end) {
  const secid = toEastmoneySecid(ts_code);

  // fields2:
  // f51 日期 YYYY-MM-DD
  // f52 开盘 f53 收盘 f54 最高 f55 最低 f56 成交量 f57 成交额
  // f61 换手率(%) f62 振幅(%) f66 涨跌幅(%) f67 涨跌额
  const params = new URLSearchParams({
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f61",
    ut: "7eea3edcaed734bea9cbfc24409ed989",
    klt: "101", // 日K
    fqt: "0",   // 不复权
    beg,
    end,
    secid,
  });

  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`;
  const r = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "referer": "https://quote.eastmoney.com/",
      "accept": "application/json, text/plain, */*",
    },
  });

  if (!r.ok) throw new Error(`Eastmoney HTTP ${r.status}`);

  const j = await r.json();
  const klines = j?.data?.klines || [];

  // 每条： "2024-01-02,open,close,high,low,vol,amt,turnover"
  const out = [];
  for (const line of klines) {
    const p = String(line).split(",");
    const date = (p[0] || "").replace(/-/g, ""); // YYYYMMDD
    const close = numOrNull(p[2]);
    const tor = numOrNull(p[7]); // f61
    if (date && Number.isFinite(close)) {
      out.push({
        trade_date: date,
        close,
        turnover_rate: Number.isFinite(tor) ? tor : null,
      });
    }
  }

  // 确保按日期升序
  out.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return out;
}

/** ----------------- Summary ----------------- **/

function buildSummary(items) {
  const closes = items.map(x => x.close).filter(Number.isFinite);
  const tors = items.map(x => x.turnover_rate).filter(Number.isFinite);

  const last = items[items.length - 1];
  const latest_close = last?.close ?? null;
  const latest_tor = last?.turnover_rate ?? null;

  return {
    start_date: items[0]?.trade_date || null,
    end_date: last?.trade_date || null,
    count: items.length,

    close_mean: closes.length ? mean(closes) : null,
    close_max: closes.length ? Math.max(...closes) : null,
    close_min: closes.length ? Math.min(...closes) : null,
    close_latest: latest_close,

    tor_mean: tors.length ? mean(tors) : null,
    tor_max: tors.length ? Math.max(...tors) : null,
    tor_min: tors.length ? Math.min(...tors) : null,
    tor_latest: latest_tor,
  };
}

/** ----------------- Utils ----------------- **/

async function fetchCnNameEastmoney(ts_code) {
  const secid = toEastmoneySecid(ts_code);
  const params = new URLSearchParams({
    ut: "fa5fd1943c7b386f172d6893dbfba10b",
    fltt: "2",
    invt: "2",
    fields: "f14", // 中文名
    secid,
  });

  const url = `https://push2.eastmoney.com/api/qt/stock/get?${params.toString()}`;
  const r = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "referer": "https://quote.eastmoney.com/",
      "accept": "application/json, text/plain, */*",
    },
  });
  if (!r.ok) return null;

  const j = await r.json();
  const name = j?.data?.f14;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}


function normalizeTsCode(code) {
  // 支持：600519 / 000001 / 600519.SH / 000001.SZ
  const c = code.toUpperCase();
  if (c.includes(".")) return c;

  // A股：6开头/9开头多为沪；0/3多为深；这里只做常见映射
  if (/^(6|9)\d{5}$/.test(c)) return `${c}.SH`;
  if (/^(0|3)\d{5}$/.test(c)) return `${c}.SZ`;

  // 兜底：直接返回
  return c;
}

function numOrNull(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function mean(arr) {
  let s = 0;
  for (const v of arr) s += v;
  return arr.length ? s / arr.length : null;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
