export default async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const sp = url.searchParams;

    const rawCode = textParam(sp, "code");
    const mode = textParam(sp, "mode") || "n";
    if (!rawCode) {
      return json({ ok: false, msg: "需要 code 参数" }, 400);
    }

    const tsCode = normalizeTsCode(rawCode);
    const priceRange = readPriceRange(sp);
    if (priceRange.error) {
      return json({ ok: false, msg: priceRange.error }, 400);
    }

    const dateRange = resolveDateRange(sp, mode);
    if (dateRange.error) {
      return json({ ok: false, msg: dateRange.error }, 400);
    }

    const itemsAll = await fetchKlineEastmoney(tsCode, dateRange.start, dateRange.end);
    if (!itemsAll.length) {
      return json({ ok: false, msg: "没有查询到数据，请检查股票代码和日期范围" }, 200);
    }

    const items = markPriceRangeHits(sliceItemsByMode(itemsAll, mode, dateRange.n), priceRange.value);
    const summary = buildSummary(items, priceRange.value);
    const nameCn = await fetchCnNameEastmoney(tsCode);

    summary.name_cn = nameCn;
    summary.ts_code = tsCode;
    summary.mode = mode;

    return json(
      {
        ok: true,
        ts_code: tsCode,
        name_cn: nameCn,
        mode,
        start: summary.start_date,
        end: summary.end_date,
        n: mode === "n" ? String(items.length) : null,
        summary,
        items,
      },
      200
    );
  } catch (error) {
    return json({ ok: false, msg: String(error?.message || error) }, 500);
  }
}

function textParam(searchParams, key) {
  return (searchParams.get(key) || "").trim();
}

function readPriceRange(searchParams) {
  const lowRaw = textParam(searchParams, "price_low");
  const highRaw = textParam(searchParams, "price_high");

  if (!lowRaw && !highRaw) {
    return { value: null };
  }

  if (!lowRaw || !highRaw) {
    return { error: "价格区间需要同时提供 price_low 和 price_high" };
  }

  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { error: "价格区间必须是有效数字" };
  }
  if (low < 0 || high < 0) {
    return { error: "价格区间不能为负数" };
  }
  if (low > high) {
    return { error: "价格区间下限不能大于上限" };
  }

  return { value: { low, high } };
}

function resolveDateRange(searchParams, mode) {
  let start = textParam(searchParams, "start") || textParam(searchParams, "start_date");
  let end = textParam(searchParams, "end") || textParam(searchParams, "end_date");
  let n = parseInt(textParam(searchParams, "n"), 10);

  if (mode === "n") {
    if (!Number.isInteger(n)) n = 60;
    n = Math.max(5, Math.min(2000, n));
    if (!end) end = ymd(new Date());
    if (!start) start = ymd(addDays(new Date(), -900));
  } else if (mode === "range") {
    if (!start || !end) {
      return { error: "mode=range 时需要 start 和 end" };
    }
  } else {
    return { error: "mode 只能是 n 或 range" };
  }

  if (!isYmd(start) || !isYmd(end)) {
    return { error: "日期必须使用 YYYYMMDD 格式" };
  }
  if (start > end) {
    return { error: "开始日期不能晚于结束日期" };
  }

  return { start, end, n };
}

function sliceItemsByMode(items, mode, n) {
  if (mode !== "n") return items;
  return items.slice(-n);
}

function markPriceRangeHits(items, priceRange) {
  return items.map((item) => ({
    ...item,
    in_price_range: priceRange ? item.close >= priceRange.low && item.close <= priceRange.high : null,
  }));
}

function buildSummary(items, priceRange) {
  const closes = items.map((item) => item.close).filter(Number.isFinite);
  const tors = items.map((item) => item.turnover_rate).filter(Number.isFinite);
  const last = items[items.length - 1] || null;

  const maxCloseRecord = findExtremeRecord(items, "close", "max");
  const minCloseRecord = findExtremeRecord(items, "close", "min");
  const maxTorRecord = findExtremeRecord(items, "turnover_rate", "max");
  const minTorRecord = findExtremeRecord(items, "turnover_rate", "min");

  const hitItems = priceRange ? items.filter((item) => item.in_price_range) : [];
  const priceRangeCount = hitItems.length;
  const priceRangeRatio = items.length ? priceRangeCount / items.length : null;

  return {
    start_date: items[0]?.trade_date || null,
    end_date: last?.trade_date || null,
    count: items.length,

    close_mean: closes.length ? mean(closes) : null,
    close_max: maxCloseRecord?.close ?? null,
    close_min: minCloseRecord?.close ?? null,
    close_latest: last?.close ?? null,
    high_date: maxCloseRecord?.trade_date ?? null,
    low_date: minCloseRecord?.trade_date ?? null,

    tor_mean: tors.length ? mean(tors) : null,
    tor_max: maxTorRecord?.turnover_rate ?? null,
    tor_min: minTorRecord?.turnover_rate ?? null,
    tor_latest: last?.turnover_rate ?? null,
    turnover_max_date: maxTorRecord?.trade_date ?? null,
    turnover_min_date: minTorRecord?.trade_date ?? null,

    price_range_enabled: Boolean(priceRange),
    price_range_low: priceRange?.low ?? null,
    price_range_high: priceRange?.high ?? null,
    price_range_count: priceRange ? priceRangeCount : null,
    price_range_ratio: priceRange ? priceRangeRatio : null,
    price_range_dates: priceRange ? hitItems.map((item) => item.trade_date) : [],
  };
}

function findExtremeRecord(items, key, type) {
  let target = null;

  for (const item of items) {
    const value = item[key];
    if (!Number.isFinite(value)) continue;

    if (!target) {
      target = item;
      continue;
    }

    if (type === "max" && value > target[key]) target = item;
    if (type === "min" && value < target[key]) target = item;
  }

  return target;
}

function toEastmoneySecid(tsCode) {
  const [code, exchange] = tsCode.split(".");
  if (exchange === "SH") return `1.${code}`;
  return `0.${code}`;
}

async function fetchKlineEastmoney(tsCode, beg, end) {
  const params = new URLSearchParams({
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f61",
    ut: "7eea3edcaed734bea9cbfc24409ed989",
    klt: "101",
    fqt: "0",
    beg,
    end,
    secid: toEastmoneySecid(tsCode),
  });

  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`, {
    headers: {
      "user-agent": "Mozilla/5.0",
      referer: "https://quote.eastmoney.com/",
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`东方财富日线接口请求失败：HTTP ${response.status}`);
  }

  const payload = await response.json();
  const klines = payload?.data?.klines;
  if (!Array.isArray(klines)) {
    return [];
  }

  const items = [];
  for (const line of klines) {
    const parts = String(line).split(",");
    const tradeDate = (parts[0] || "").replace(/-/g, "");
    const close = Number(parts[2]);
    const turnoverRate = Number(parts[7]);

    if (!isYmd(tradeDate) || !Number.isFinite(close)) {
      continue;
    }

    items.push({
      trade_date: tradeDate,
      close,
      turnover_rate: Number.isFinite(turnoverRate) ? turnoverRate : null,
    });
  }

  items.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return items;
}

async function fetchCnNameEastmoney(tsCode) {
  const secid = toEastmoneySecid(tsCode);

  try {
    const directParams = new URLSearchParams({
      ut: "fa5fd1943c7b386f172d6893dbfba10b",
      fltt: "2",
      invt: "2",
      fields: "f14",
      secid,
    });

    const directResponse = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?${directParams.toString()}`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        referer: "https://quote.eastmoney.com/",
        accept: "application/json, text/plain, */*",
      },
    });

    if (directResponse.ok) {
      const payload = await directResponse.json();
      const name = payload?.data?.f14;
      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
    }
  } catch (_) {}

  try {
    const code = tsCode.split(".")[0];
    const suggestParams = new URLSearchParams({
      input: code,
      type: "14",
      token: "ff9f9b2c1a1f4b9d",
      count: "5",
    });

    const suggestResponse = await fetch(`https://searchapi.eastmoney.com/api/suggest/get?${suggestParams.toString()}`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        referer: "https://quote.eastmoney.com/",
        accept: "application/json, text/plain, */*",
      },
    });

    if (!suggestResponse.ok) {
      return null;
    }

    const payload = await suggestResponse.json();
    const candidates = payload?.QuotationCodeTable?.Data;
    if (Array.isArray(candidates) && candidates.length) {
      const exact = candidates.find((item) => String(item?.Code) === code) || candidates[0];
      const name = exact?.Name;
      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
    }
  } catch (_) {}

  return null;
}

function normalizeTsCode(code) {
  const normalized = code.toUpperCase();
  if (normalized.includes(".")) return normalized;
  if (/^(6|9)\d{5}$/.test(normalized)) return `${normalized}.SH`;
  if (/^(0|3)\d{5}$/.test(normalized)) return `${normalized}.SZ`;
  if (/^8\d{5}$/.test(normalized)) return `${normalized}.BJ`;
  return normalized;
}

function mean(arr) {
  return arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : null;
}

function isYmd(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return ymd(date) === value;
}

function ymd(date) {
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
