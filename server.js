const express = require("express");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");
const { calcIndicators } = require("./indicators");
const { scoreMarket } = require("./scorer");

const app = express();
const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";
const API = "https://apiv2.nobitex.ir";
const WS_URL = "wss://ws.nobitex.ir/connection/websocket";

const markets = new Map();
const candles = new Map();
const books = new Map();
const trades = new Map();
let ws = null;
let reconnectDelay = 1000;
let lastStatsAt = 0;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "nobitex-screener/1.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
          resolve(JSON.parse(data));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function symbolListFromStats(stats) {
  return Object.entries(stats || {})
    .filter(([symbol, x]) => symbol.endsWith("IRT") && x && Number(x.volume) > 0)
    .sort((a,b) => Number(b[1].volume) - Number(a[1].volume))
    .slice(0, 50)
    .map(([symbol]) => symbol);
}

async function fetchHistory(symbol) {
  const now = Math.floor(Date.now()/1000);
  const from = now - 100 * 15 * 60;
  const url = `${API}/market/udf/history?symbol=${encodeURIComponent(symbol)}&resolution=15&from=${from}&to=${now}`;
  const d = await getJson(url);
  if (d.s !== "ok" || !Array.isArray(d.c)) return [];
  const out = [];
  for (let i=0;i<d.c.length;i++) {
    if ([d.t?.[i],d.o?.[i],d.h?.[i],d.l?.[i],d.c?.[i],d.v?.[i]].some(v => v == null)) continue;
    out.push({ t:Number(d.t[i]), o:Number(d.o[i]), h:Number(d.h[i]), l:Number(d.l[i]), c:Number(d.c[i]), v:Number(d.v[i]) });
  }
  return out.slice(-100);
}

async function fetchOrderbook(symbol) {
  const d = await getJson(`${API}/v3/orderbook/${encodeURIComponent(symbol)}`);
  if (!d) return;
  books.set(symbol, {
    asks: Array.isArray(d.asks) ? d.asks.map(x => [Number(x[0]),Number(x[1])]) : [],
    bids: Array.isArray(d.bids) ? d.bids.map(x => [Number(x[0]),Number(x[1])]) : []
  });
}

async function refreshStats() {
  if (Date.now() - lastStatsAt < 60000) return;
  lastStatsAt = Date.now();
  try {
    const d = await getJson(`${API}/market/stats`);
    const stats = d.stats || {};
    for (const [symbol, x] of Object.entries(stats)) {
      if (!symbol.endsWith("IRT")) continue;
      markets.set(symbol, { ...(markets.get(symbol)||{}), ...x });
    }
    const top = symbolListFromStats(stats);
    for (let i=0;i<top.length;i++) {
      const s = top[i];
      try {
        const hist = await fetchHistory(s);
        if (hist.length >= 30) candles.set(s, hist);
        await fetchOrderbook(s);
      } catch (_) {}
      await sleep(80);
    }
    subscribeTop(top);
  } catch (e) {
    console.error("stats refresh:", e.message);
  }
}

function addCandle(symbol, c) {
  if (!c || !Number.isFinite(Number(c.t))) return;
  const arr = candles.get(symbol) || [];
  const item = { t:Number(c.t), o:Number(c.o), h:Number(c.h), l:Number(c.l), c:Number(c.c), v:Number(c.v) };
  const idx = arr.findIndex(x => x.t === item.t);
  if (idx >= 0) arr[idx] = item; else arr.push(item);
  arr.sort((a,b)=>a.t-b.t);
  candles.set(symbol, arr.slice(-150));
}

function handleTrade(symbol, payload) {
  let arr = trades.get(symbol) || [];
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const x of rows) {
    if (!x) continue;
    const price = Number(x.p ?? x.price);
    const amount = Number(x.a ?? x.amount);
    if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
    const side = String(x.type ?? x.side ?? "").toLowerCase();
    arr.push({ t: Number(x.t ?? x.timestamp ?? Date.now()/1000), price, amount, side });
  }
  const cutoff = Date.now()/1000 - 5*60;
  arr = arr.filter(x => x.t >= cutoff).slice(-1000);
  trades.set(symbol, arr);
}

function handleBook(symbol, p) {
  if (!p) return;
  if (p.bids || p.asks) {
    const b = p.bids || [], a = p.asks || [];
    books.set(symbol, {
      bids: b.map(x => [Number(x[0]),Number(x[1])]),
      asks: a.map(x => [Number(x[0]),Number(x[1])])
    });
  }
}

function sendSub(channel) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ method:"subscribe", params:{ channel } }));
}

function subscribeTop(top) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  sendSub("public:market-stats-all");
  for (const s of top) {
    sendSub(`public:candle-${s}-15`);
    sendSub(`public:orderbook-${s}`);
    sendSub(`public:trades-${s}`);
  }
}

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.on("open", () => {
    reconnectDelay = 1000;
    subscribeTop(symbolListFromStats(Object.fromEntries(markets)));
  });
  ws.on("message", raw => {
    try {
      const m = JSON.parse(raw.toString());
      const ch = m.channel || m.event?.channel || "";
      const p = m.data ?? m.result ?? m;
      if (ch === "public:market-stats-all") {
        const data = p.data || p;
        if (data && typeof data === "object") for (const [s,x] of Object.entries(data)) {
          if (s.endsWith("IRT")) markets.set(s,{...(markets.get(s)||{}),...x});
        }
        return;
      }
      const parts = ch.split("-");
      if (ch.startsWith("public:candle-")) {
        const s = ch.replace("public:candle-","").replace(/-15$/,"");
        const x = p.data || p;
        const c = Array.isArray(x) ? x[0] : x;
        addCandle(s, c);
      } else if (ch.startsWith("public:orderbook-")) {
        const s = ch.replace("public:orderbook-","");
        handleBook(s, p.data || p);
      } else if (ch.startsWith("public:trades-")) {
        const s = ch.replace("public:trades-","");
        handleTrade(s, p.data || p);
      }
    } catch (_) {}
  });
  ws.on("close", () => { setTimeout(connectWS, reconnectDelay); reconnectDelay = Math.min(reconnectDelay*2,30000); });
  ws.on("error", () => { try { ws.close(); } catch(_){} });
}

function makeRow(symbol) {
  const m = markets.get(symbol) || {};
  const cs = candles.get(symbol) || [];
  const book = books.get(symbol) || {};
  const tr = trades.get(symbol) || [];
  const indicators = calcIndicators(cs, m);
  const score = scoreMarket({ market:m, indicators, book, trades:tr });
  return { symbol, ...score, ...indicators, price:Number(m.latest ?? m.lastTradePrice ?? indicators.last ?? 0), volume:Number(m.volume ?? 0), change24:Number(m.dayChange ?? m.dayChangePercent ?? 0) };
}

app.get("/api/health", (_,res) => res.json({ ok:true, markets:markets.size, deep:candles.size, time:new Date().toISOString() }));
app.get("/api/markets", async (_,res) => {
  await refreshStats();
  const rows = [...markets.keys()].filter(s=>s.endsWith("IRT")).map(makeRow)
    .filter(x=>x.price>0).sort((a,b)=>b.score-a.score);
  res.json({ updatedAt:Date.now(), count:rows.length, rows });
});

app.use((_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

refreshStats().finally(connectWS);
setInterval(refreshStats, 5*60*1000);
setInterval(()=>{}, 1<<30);
app.listen(PORT, HOST, ()=>console.log(`Nobitex screener listening on ${HOST}:${PORT}`));
