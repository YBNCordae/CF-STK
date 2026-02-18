export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ts_code = url.searchParams.get("code");     // 例如 002156.SZ
  const start_date = url.searchParams.get("start"); // 例如 20250101
  const end_date = url.searchParams.get("end");     // 例如 20250218
  const buy = Number(url.searchParams.get("buy") || "0");

  if (!ts_code || !start_date || !end_date) {
    return json({ ok: false, msg: "缺少参数 code/start/end" }, 400);
  }
  if (!env.TUSHARE_TOKEN) {
    return json({ ok: false, msg: "未配置 TUSHARE_TOKEN" }, 500);
  }

  // 1) 拉数据（TuShare daily）
  const resp = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_name: "daily",
      token: env.TUSHARE_TOKEN,
      params: { ts_code, start_date, end_date },
      fields: "trade_date,open,high,low,close,vol,amount"
    })
  });

  const data = await resp.json();
  if (!data || data.code !== 0) {
    return json({ ok: false, msg: `TuShare error: ${data?.msg || "unknown"}` }, 500);
  }

  // TuShare 返回通常是倒序，这里转成正序
  const items = (data.data.items || []).map(row => ({
    trade_date: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    vol: row[5],
    amount: row[6]
  })).sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  if (items.length === 0) {
    return json({ ok: true, items: [], summary: null }, 200);
  }

  // 2) 计算区间高低点与日期
  let hi = items[0], lo = items[0];
  for (const x of items) {
    if (x.high > hi.high) hi = x;
    if (x.low < lo.low) lo = x;
  }

  const last = items[items.length - 1];
  const summary = {
    code: ts_code,
    start: start_date,
    end: end_date,
    high: hi.high,
    high_date: hi.trade_date,
    low: lo.low,
    low_date: lo.trade_date,
    close: last.close,
    close_date: last.trade_date,
    buy: buy || null,
    // 买入价对比（你后续可按 app.py 逻辑改）
    diff_to_buy: buy ? (last.close - buy) : null,
    pct_to_buy: buy ? ((last.close - buy) / buy) : null,
  };

  return json({ ok: true, items, summary }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}
