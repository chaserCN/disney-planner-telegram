const express = require("express");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const TelegramBot = require("node-telegram-bot-api");
const { R: RIDES } = require("./public/rides-data");

const app = express();
const PORT = process.env.PORT || 3000;
const PARK_IDS = [4, 28];
const COLLECT_INTERVAL_MS = 10 * 60 * 1000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "disney.sqlite");

const COLLECT_START_MINUTES = 9 * 60 + 30;
const COLLECT_END_MINUTES = 22 * 60 + 40;
const ALERT_START_MINUTES = 9 * 60 + 30;
const ALERT_END_MINUTES = 22 * 60 + 40;
const ALERT_CURRENT_MAX_WAIT = 10;
const ALERT_BASELINE_MIN_WAIT = 30;
const ALERT_MIN_BASELINE_SAMPLES = 24;
const ALERT_DEBOUNCE_MS = 60 * 60 * 1000;
const ALERT_BURST_WINDOW_MS = 10 * 60 * 1000;
const ALERT_BURST_LIMIT = 3;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS wait_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL,
    park_id INTEGER NOT NULL,
    ride_name TEXT NOT NULL,
    sampled_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    local_time TEXT NOT NULL,
    time_bucket TEXT NOT NULL,
    hour INTEGER NOT NULL,
    weekday INTEGER NOT NULL,
    day_type TEXT NOT NULL,
    is_open INTEGER NOT NULL,
    wait_time INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_wait_samples_baseline
    ON wait_samples (day_type, ride_id, hour, sampled_at);

  CREATE INDEX IF NOT EXISTS idx_wait_samples_date
    ON wait_samples (local_date);

  CREATE TABLE IF NOT EXISTS subscribers (
    chat_id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    ride_id INTEGER NOT NULL,
    sent_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_log_lookup
    ON alerts_log (chat_id, ride_id, sent_at);
`);

const insertSample = db.prepare(`
  INSERT INTO wait_samples (
    ride_id, park_id, ride_name, sampled_at, local_date, local_time,
    time_bucket, hour, weekday, day_type, is_open, wait_time
  ) VALUES (
    @ride_id, @park_id, @ride_name, @sampled_at, @local_date, @local_time,
    @time_bucket, @hour, @weekday, @day_type, @is_open, @wait_time
  )
`);

const insertSamples = db.transaction(samples => {
  samples.forEach(sample => insertSample.run(sample));
});

const baselineRows = db.prepare(`
  SELECT ride_id, hour, wait_time
  FROM wait_samples
  WHERE day_type = ?
    AND is_open = 1
    AND sampled_at >= datetime('now', '-120 days')
  ORDER BY ride_id, hour, wait_time
`);
const historyStats = db.prepare(`
  SELECT
    COUNT(*) AS total_samples,
    COUNT(DISTINCT ride_id) AS ride_count,
    MIN(sampled_at) AS first_sample_at,
    MAX(sampled_at) AS last_sample_at
  FROM wait_samples
`);
const todayStats = db.prepare(`
  SELECT COUNT(*) AS samples_today
  FROM wait_samples
  WHERE local_date = ?
`);
const dayTypeStats = db.prepare(`
  SELECT day_type, COUNT(*) AS samples
  FROM wait_samples
  GROUP BY day_type
  ORDER BY day_type
`);

const subscribersAll = db.prepare("SELECT chat_id FROM subscribers");
const subscribeStmt = db.prepare(
  "INSERT OR IGNORE INTO subscribers (chat_id, created_at) VALUES (?, ?)"
);
const unsubscribeStmt = db.prepare("DELETE FROM subscribers WHERE chat_id = ?");
const isSubscribedStmt = db.prepare("SELECT 1 FROM subscribers WHERE chat_id = ?");
const recentAlertByRide = db.prepare(
  "SELECT 1 FROM alerts_log WHERE chat_id = ? AND ride_id = ? AND sent_at >= ? LIMIT 1"
);
const recentAlertsCount = db.prepare(
  "SELECT COUNT(*) AS c FROM alerts_log WHERE chat_id = ? AND sent_at >= ?"
);
const insertAlert = db.prepare(
  "INSERT INTO alerts_log (chat_id, ride_id, sent_at) VALUES (?, ?, ?)"
);
const baselineForRide = db.prepare(`
  SELECT wait_time
  FROM wait_samples
  WHERE day_type = ?
    AND ride_id = ?
    AND hour = ?
    AND is_open = 1
    AND sampled_at >= datetime('now', '-120 days')
  ORDER BY wait_time
`);

const sampleCount = db.prepare("SELECT COUNT(*) AS count FROM wait_samples").get().count;
console.log(`SQLite wait history: ${DB_PATH} (${sampleCount} samples)`);

let botInstance = null;
let appUrl = null;

const rideByIdIndex = new Map();
for (const [name, meta] of Object.entries(RIDES)) {
  rideByIdIndex.set(meta.id, { name, ...meta });
}
const ALERT_TIER_SET = new Set(["S", "A"]);

function percentileFromSorted(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.ceil(sortedValues.length * p) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

function isWithinMinutesWindow(paris, startMinutes, endMinutes) {
  const [hour, minute] = paris.localTime.split(":").map(Number);
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= startMinutes && totalMinutes < endMinutes;
}

async function checkAndSendAlerts(paris, livePerRideId) {
  if (!botInstance) return;
  if (!isWithinMinutesWindow(paris, ALERT_START_MINUTES, ALERT_END_MINUTES)) return;

  const subscribers = subscribersAll.all();
  if (!subscribers.length) return;

  const nowIso = new Date().toISOString();
  const debounceCutoff = new Date(Date.now() - ALERT_DEBOUNCE_MS).toISOString();
  const burstCutoff = new Date(Date.now() - ALERT_BURST_WINDOW_MS).toISOString();

  const candidates = [];
  for (const [rideId, live] of livePerRideId) {
    if (!live.is_open) continue;
    if (live.wait_time > ALERT_CURRENT_MAX_WAIT) continue;
    const meta = rideByIdIndex.get(rideId);
    if (!meta || !ALERT_TIER_SET.has(meta.t)) continue;

    const waits = baselineForRide.all(paris.dayType, rideId, paris.hour).map(r => r.wait_time);
    if (waits.length < ALERT_MIN_BASELINE_SAMPLES) continue;
    const median = percentileFromSorted(waits, 0.5);
    if (median === null || median < ALERT_BASELINE_MIN_WAIT) continue;

    candidates.push({ rideId, meta, current: live.wait_time, median });
  }

  if (!candidates.length) return;

  for (const sub of subscribers) {
    const chatId = sub.chat_id;
    let sentInBurstWindow = recentAlertsCount.get(chatId, burstCutoff).c;
    if (sentInBurstWindow >= ALERT_BURST_LIMIT) continue;

    for (const c of candidates) {
      if (sentInBurstWindow >= ALERT_BURST_LIMIT) break;
      if (recentAlertByRide.get(chatId, c.rideId, debounceCutoff)) continue;
      const sent = await sendAlert(chatId, c);
      if (!sent) continue;
      insertAlert.run(chatId, c.rideId, nowIso);
      sentInBurstWindow += 1;
    }
  }
}

async function sendAlert(chatId, c) {
  const text =
    `🎯 *${escapeMarkdown(c.meta.name)}* — ${c.current} мин\n` +
    `Обычно в это время ~${c.median} мин`;

  const keyboard = appUrl
    ? { inline_keyboard: [[{ text: "🗺️ Открыть планировщик", web_app: { url: appUrl } }]] }
    : undefined;

  try {
    await botInstance.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
    return true;
  } catch (err) {
    console.error(`Alert send failed for ${chatId}:`, err.message);
    if (err.response && err.response.statusCode === 403) {
      unsubscribeStmt.run(chatId);
      console.log(`Auto-unsubscribed ${chatId} (blocked by user)`);
    }
    return false;
  }
}

function escapeMarkdown(text) {
  return String(text).replace(/([_*`\[\]()])/g, "\\$1");
}

// ── Queue-Times API proxy (solves CORS) ─────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (/\.(jpg|jpeg|png|webp|svg|gif)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    }
  }
}));

const COORDS_PATH = path.join(__dirname, "data", "ride-coords.json");

function readCoords() {
  try {
    return JSON.parse(fs.readFileSync(COORDS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeCoords(coords) {
  fs.writeFileSync(COORDS_PATH, JSON.stringify(coords, null, 2));
}

app.get("/api/coords", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readCoords());
});

app.post("/api/coords", (req, res) => {
  const { name, mx, my } = req.body || {};
  if (typeof name !== "string" || !name || typeof mx !== "number" || typeof my !== "number") {
    return res.status(400).json({ error: "Expected {name, mx, my}" });
  }
  const coords = readCoords();
  coords[name] = { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100 };
  writeCoords(coords);
  res.json({ ok: true, coords });
});

app.delete("/api/coords/:name", (req, res) => {
  const coords = readCoords();
  delete coords[req.params.name];
  writeCoords(coords);
  res.json({ ok: true, coords });
});

function verifyInitData(initData) {
  if (!initData || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const crypto = require("crypto");
  const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (computed !== hash) return null;
  try {
    const user = JSON.parse(params.get("user"));
    return { chatId: user.id };
  } catch {
    return null;
  }
}

app.post("/api/subscribe", (req, res) => {
  const auth = verifyInitData(req.body && req.body.initData);
  if (!auth) return res.status(401).json({ error: "Invalid initData" });
  subscribeStmt.run(auth.chatId, new Date().toISOString());
  res.json({ ok: true, subscribed: true });
});

app.post("/api/unsubscribe", (req, res) => {
  const auth = verifyInitData(req.body && req.body.initData);
  if (!auth) return res.status(401).json({ error: "Invalid initData" });
  unsubscribeStmt.run(auth.chatId);
  res.json({ ok: true, subscribed: false });
});

app.post("/api/subscription-status", (req, res) => {
  const auth = verifyInitData(req.body && req.body.initData);
  if (!auth) return res.status(401).json({ error: "Invalid initData" });
  const subscribed = !!isSubscribedStmt.get(auth.chatId);
  res.json({ ok: true, subscribed });
});

async function fetchParkQueue(parkId) {
  const r = await fetch(`https://queue-times.com/parks/${parkId}/queue_times.json`);
  if (!r.ok) throw new Error(`Queue-Times ${parkId}: HTTP ${r.status}`);
  return r.json();
}

app.get("/api/queue/:parkId", async (req, res) => {
  try {
    const data = await fetchParkQueue(req.params.parkId);
    res.set("Cache-Control", "public, max-age=120");
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch" });
  }
});

app.get("/api/baseline", (req, res) => {
  const requested = String(req.query.day_type || getParisDateParts(new Date()).dayType);
  const dayType = ["weekday", "weekend", "holiday"].includes(requested) ? requested : "weekday";
  const groups = new Map();

  for (const row of baselineRows.all(dayType)) {
    const key = `${row.ride_id}:${row.hour}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.wait_time);
  }

  const rides = {};
  for (const [key, waits] of groups) {
    const [rideId, hour] = key.split(":");
    rides[rideId] ||= {};
    rides[rideId][hour] = {
      sample_count: waits.length,
      p25: percentile(waits, 0.25),
      median: percentile(waits, 0.5),
      p75: percentile(waits, 0.75)
    };
  }

  res.set("Cache-Control", "public, max-age=300");
  res.json({ day_type: dayType, rides });
});

app.get("/api/history/status", (req, res) => {
  const paris = getParisDateParts(new Date());
  const stats = historyStats.get();
  const byDayType = {};

  for (const row of dayTypeStats.all()) {
    byDayType[row.day_type] = row.samples;
  }

  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    db_path: DB_PATH,
    collector_interval_minutes: COLLECT_INTERVAL_MS / 60000,
    paris_now: `${paris.localDate} ${paris.localTime}`,
    today_type: paris.dayType,
    total_samples: stats.total_samples,
    samples_today: todayStats.get(paris.localDate).samples_today,
    ride_count: stats.ride_count,
    first_sample_at: stats.first_sample_at,
    last_sample_at: stats.last_sample_at,
    by_day_type: byDayType
  });
});

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function getParisDateParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  }).formatToParts(date).map(part => [part.type, part.value]));

  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekday = weekdayMap[parts.weekday] || 1;
  const bucketMinute = Math.floor(minute / 10) * 10;
  const timeBucket = `${String(hour).padStart(2, "0")}:${String(bucketMinute).padStart(2, "0")}`;
  const dayType = isFrenchPublicHoliday(localDate) ? "holiday" : weekday >= 6 ? "weekend" : "weekday";

  return {
    localDate,
    localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    timeBucket,
    hour,
    weekday,
    dayType
  };
}

function isFrenchPublicHoliday(localDate) {
  const [year, month, day] = localDate.split("-").map(Number);
  const fixed = new Set([
    `${year}-01-01`,
    `${year}-05-01`,
    `${year}-05-08`,
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`
  ]);
  const easter = getEasterDate(year);
  const moveable = [1, 39, 50].map(offsetDays => addDays(easter, offsetDays));
  return fixed.has(localDate) || moveable.includes(localDate);
}

function getEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(localDate, days) {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function collectWaitSamples() {
  const sampledAt = new Date();
  const paris = getParisDateParts(sampledAt);

  if (!isWithinMinutesWindow(paris, COLLECT_START_MINUTES, COLLECT_END_MINUTES)) {
    return;
  }

  try {
    const parks = await Promise.all(PARK_IDS.map(async parkId => ({ parkId, data: await fetchParkQueue(parkId) })));
    const samples = [];
    const livePerRideId = new Map();

    for (const { parkId, data } of parks) {
      for (const land of data.lands || []) {
        for (const ride of land.rides || []) {
          const waitTime = Number.isFinite(ride.wait_time) ? ride.wait_time : 0;
          samples.push({
            ride_id: ride.id,
            park_id: parkId,
            ride_name: ride.name,
            sampled_at: sampledAt.toISOString(),
            local_date: paris.localDate,
            local_time: paris.localTime,
            time_bucket: paris.timeBucket,
            hour: paris.hour,
            weekday: paris.weekday,
            day_type: paris.dayType,
            is_open: ride.is_open ? 1 : 0,
            wait_time: waitTime
          });
          livePerRideId.set(ride.id, { is_open: !!ride.is_open, wait_time: waitTime });
        }
      }
    }

    insertSamples(samples);
    const stats = historyStats.get();
    const samplesToday = todayStats.get(paris.localDate).samples_today;
    console.log(
      `Collected ${samples.length} wait samples (${paris.dayType} ${paris.localTime}); ` +
      `total=${stats.total_samples}, today=${samplesToday}, rides=${stats.ride_count}, db=${DB_PATH}`
    );

    await checkAndSendAlerts(paris, livePerRideId);
  } catch (err) {
    console.error("Failed to collect wait samples:", err.message);
  }
}

function startCollector() {
  collectWaitSamples();
  setInterval(collectWaitSamples, COLLECT_INTERVAL_MS);
}

// ── Start server ────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startCollector();
  startBot();
});

// ── Telegram Bot ────────────────────────────────────────────────────────────
function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("No TELEGRAM_BOT_TOKEN set — bot disabled, web-only mode");
    return;
  }

  appUrl = process.env.APP_URL; // e.g. https://disney-planner.up.railway.app
  if (!appUrl) {
    console.log("No APP_URL set — bot can't link to Mini App");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  botInstance = bot;

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      "🏰 *Disneyland Paris Planner*\n\n" +
      "Рейтинг аттракционов, live очереди, тепловые карты загруженности и карта парка.\n\n" +
      "Команды:\n" +
      "/subscribe — уведомления о коротких очередях\n" +
      "/unsubscribe — отключить уведомления\n" +
      "/status — статус подписки\n\n" +
      "Нажми кнопку ниже, чтобы открыть планировщик 👇",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "🗺️ Открыть планировщик", web_app: { url: appUrl } }
          ]]
        }
      }
    );
  });

  bot.onText(/\/subscribe/, (msg) => {
    subscribeStmt.run(msg.chat.id, new Date().toISOString());
    bot.sendMessage(msg.chat.id,
      "🔔 *Уведомления включены*\n\n" +
      "Будем писать, когда у популярного аттракциона очередь резко упадёт (в часы работы парка, 09:30–22:40 по Парижу).\n\n" +
      "Отключить — /unsubscribe",
      { parse_mode: "Markdown" }
    );
  });

  bot.onText(/\/unsubscribe/, (msg) => {
    unsubscribeStmt.run(msg.chat.id);
    bot.sendMessage(msg.chat.id,
      "🔕 Уведомления отключены. Включить снова — /subscribe"
    );
  });

  bot.onText(/\/status/, (msg) => {
    const subscribed = !!isSubscribedStmt.get(msg.chat.id);
    bot.sendMessage(msg.chat.id,
      subscribed
        ? "🔔 Уведомления включены. Отключить — /unsubscribe"
        : "🔕 Уведомления отключены. Включить — /subscribe"
    );
  });

  bot.onText(/\/wait/, async (msg) => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("https://queue-times.com/parks/4/queue_times.json"),
        fetch("https://queue-times.com/parks/28/queue_times.json")
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

      const TOP_RIDES = [
        { id: 25, name: "Big Thunder Mountain" },
        { id: 8, name: "Hyperspace Mountain" },
        { id: 22, name: "Peter Pan's Flight" },
        { id: 15413, name: "Frozen Ever After" },
        { id: 26, name: "Phantom Manor" },
        { id: 3, name: "Pirates of the Caribbean" },
        { id: 32, name: "Crush's Coaster" },
        { id: 40, name: "Tower of Terror" },
        { id: 37, name: "Ratatouille" },
        { id: 10848, name: "Avengers Assemble" }
      ];

      const all = {};
      const proc = d => (d.lands||[]).forEach(l => (l.rides||[]).forEach(r => { all[r.id] = r; }));
      proc(d1); proc(d2);

      let text = "⏱ *Live очереди — топ аттракционы*\n\n";
      TOP_RIDES.forEach(({ id, name }) => {
        const r = all[id];
        if (!r) return;
        const status = !r.is_open ? "🔴 Закрыт" :
          r.wait_time === 0 ? "🟢 walk-on" :
          r.wait_time <= 15 ? `🟢 ${r.wait_time} мин` :
          r.wait_time <= 40 ? `🟡 ${r.wait_time} мин` :
          `🔴 ${r.wait_time} мин`;
        text += `${status}  ${name}\n`;
      });
      text += "\n_Данные: Queue-Times.com_";

      bot.sendMessage(msg.chat.id, text, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "🗺️ Полный планировщик", web_app: { url: appUrl } }
          ]]
        }
      });
    } catch {
      bot.sendMessage(msg.chat.id, "Не удалось загрузить данные. Попробуйте позже.");
    }
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      "🏰 *Disney Paris Planner — Команды*\n\n" +
      "/start — открыть планировщик\n" +
      "/wait — текущие очереди (текст)\n" +
      "/subscribe — уведомления о коротких очередях\n" +
      "/unsubscribe — отключить уведомления\n" +
      "/status — статус подписки\n" +
      "/help — эта справка",
      { parse_mode: "Markdown" }
    );
  });

  console.log("Telegram bot started");
}
