// functions/api/stock.js
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const codeRaw = (url.searchParams.get("code") || "").trim();
  const mode = (url.searchParams.get("mode") || "n").trim(); // n | range
  const n = Number(url.searchParams.get("n") || "60");
  const start = (url.searchParams.get("start") || "").trim(); // YYYYMMDD
  const end = (url.searchParams.get("end") || "").trim();     // YYYYMMDD

  if (!codeRaw) return json({ ok: false, msg: "缺少参数 code" }, 400);
  if (!env.TUSHARE_TOKEN) return json({ ok: false, msg: "未配置环境变量 TUSHARE_TOKEN" }, 500);

  // ====== cache (15 min) ======
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const ts_code = toTsCode(codeRaw);

  // mode=n：后端也支持（前端通常会把 start/end 计算好传过来）
  let startDate = start, endDate = end;
  if (mode === "n") {
    if (!startDate || !endDate || !Number.isFinite(n) || n <= 0) {
      return json({ ok: false, msg: "mode=n 需要 start/end/n" }, 400);
    }
  } else {
    if (!startDate || !endDate) return json({ ok: false, msg: "mode=range 需要 start/end" }, 400);
  }

  try {
    // 1) daily：收盘价
    const daily = await callTuShare(
      env.TUSHARE_TOKEN,
      "daily",
      { ts_code, start_date: startDate, end_date: endDate },
      "trade_date,close"
    );

    if (!daily.length) {
      const resp = json({ ok: true, items: [], summary: null }, 200, { "Cache-Control": "public, max-age=300" });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }

    // 2) daily_basic：换手率（%）
    // 字段：turnover_rate（换手率%）来自 TuShare 文档
    const basics = await callTuShare(
      env.TUSHARE_TOKEN,
      "daily_basic",
      { ts_code, start_date: startDate, end_date: endDate },
      "trade_date,turnover_rate"
    );

    const torMap = new Map(basics.map(r => [r.trade_date, numOrNull(r.turnover_rate)]));

    // 3) merge + sort asc
    let items = daily
      .map(r => ({
        trade_date: r.trade_date,
        close: numOrNull(r.close),
        turnover_rate: torMap.has(r.trade_date) ? torMap.get(r.trade_date) : null,
      }))
      .filter(x => Number.isFinite(x.close))
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

    // mode=n：取最后 n 个交易日
    if (mode === "n") {
      if (items.length < n) {
        return json({ ok: false, msg: `数据不足：仅 ${items.length} 条，少于 N=${n}` }, 400);
      }
      items = items.slice(items.length - n);
    }

    // ====== stats (close) ======
    const closes = items.map(x => x.close);
    const todayClose = closes[closes.length - 1];
    const mean = avg(closes);
    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const asof = items[items.length - 1].trade_date;

    const highDates = items.filter(x => x.close === high).map(x => x.trade_date);
    const lowDates = items.filter(x => x.close === low).map(x => x.trade_date);
    const highDateInfo = extremeDateSummary(highDates);
    const lowDateInfo = extremeDateSummary(lowDates);

    const devVsMean = mean ? (todayClose - mean) / mean : 0;
    const riseFromLow = low ? (todayClose - low) / low : 0;
    const drawdownFromHigh = high ? (todayClose - high) / high : 0;
    const amplitude = low ? (high - low) / low : 0;

    const posInRange = high !== low ? (todayClose - low) / (high - low) : 0;
    const posPct = posInRange * 100;

    // ====== stats (turnover_rate) ======
    const tors = items.map(x => x.turnover_rate).filter(v => Number.isFinite(v));
    const torLatest = items[items.length - 1].turnover_rate ?? null;
    const torMean = tors.length ? avg(tors) : null;
    const torMax = tors.length ? Math.max(...tors) : null;
    const torMin = tors.length ? Math.min(...tors) : null;

    const torMaxDates = torMax == null ? [] : items.filter(x => x.turnover_rate === torMax).map(x => x.trade_date);
    const torMinDates = torMin == null ? [] : items.filter(x => x.turnover_rate === torMin).map(x => x.trade_date);

    const summary = {
      ts_code,
      mode,
      start: items[0].trade_date,
      end: asof,
      count: items.length,

      today_close: todayClose,
      mean,
      high,
      low,
      high_date_short: highDateInfo.short,
      high_date_help: highDateInfo.help,
      low_date_short: lowDateInfo.short,
      low_date_help: lowDateInfo.help,

      dev_vs_mean: devVsMean,
      rise_from_low: riseFromLow,
      drawdown_from_high: drawdownFromHigh,
      amplitude,
      pos_pct: posPct,

      // turnover
      turnover_latest: torLatest,
      turnover_mean: torMean,
      turnover_max: torMax,
      turnover_max_date_short: extremeDateSummary(torMaxDates).short,
      turnover_min: torMin,
      turnover_min_date_short: extremeDateSummary(torMinDates).short,
    };

    const resp = json({ ok: true, items, summary }, 200, { "Cache-Control": "public, max-age=900" });
    context.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;

  } catch (e) {
    return json({ ok: false, msg: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    }
  });
}

function toTsCode(code) {
  const c = (code || "").trim().toUpperCase();
  if (c.endsWith(".SH") || c.endsWith(".SZ") || c.endsWith(".BJ")) return c;
  if (/^\d{6}$/.test(c)) {
    if (c.startsWith("6")) return `${c}.SH`;
    if (c.startsWith("0") || c.startsWith("3")) return `${c}.SZ`;
    if (c.startsWith("4") || c.startsWith("8")) return `${c}.BJ`;
  }
  return c;
}

async function callTuShare(token, api_name, params, fields) {
  const r = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_name, token, params, fields })
  });
  if (!r.ok) throw new Error(`TuShare HTTP ${r.status}`);
  const j = await r.json();
  if (j?.code !== 0) throw new Error(`TuShare error ${j?.code}: ${j?.msg}`);

  const f = j.data.fields;
  const items = j.data.items || [];
  const idx = Object.fromEntries(f.map((name, i) => [name, i]));

  return items.map(row => {
    const o = {};
    for (const k of f) o[k] = row[idx[k]];
    return o;
  });
}

function numOrNull(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function avg(arr) {
  let s = 0;
  for (const v of arr) s += v;
  return arr.length ? s / arr.length : 0;
}

function cnDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return `${y}年${m}月${d}日`;
}

function extremeDateSummary(dates) {
  const uniq = [...new Set((dates || []).filter(Boolean))].sort();
  if (!uniq.length) return { short: "-", help: "未找到日期" };
  if (uniq.length === 1) {
    const d = cnDate(uniq[0]);
    return { short: d, help: `出现日期：${d}` };
  }
  const first = cnDate(uniq[0]);
  const last = cnDate(uniq[uniq.length - 1]);
  return { short: `${first} 等${uniq.length}天`, help: `共出现 ${uniq.length} 天；最早：${first}；最晚：${last}` };
}
