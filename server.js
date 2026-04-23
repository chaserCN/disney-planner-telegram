const express = require("express");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;
const PARK_IDS = [4, 28];
const COLLECT_INTERVAL_MS = 10 * 60 * 1000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "disney.sqlite");

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

const sampleCount = db.prepare("SELECT COUNT(*) AS count FROM wait_samples").get().count;
console.log(`SQLite wait history: ${DB_PATH} (${sampleCount} samples)`);

// ── Queue-Times API proxy (solves CORS) ─────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

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

  try {
    const parks = await Promise.all(PARK_IDS.map(async parkId => ({ parkId, data: await fetchParkQueue(parkId) })));
    const samples = [];

    for (const { parkId, data } of parks) {
      for (const land of data.lands || []) {
        for (const ride of land.rides || []) {
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
            wait_time: Number.isFinite(ride.wait_time) ? ride.wait_time : 0
          });
        }
      }
    }

    insertSamples(samples);
    console.log(`Collected ${samples.length} wait samples (${paris.dayType} ${paris.localTime})`);
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

  const appUrl = process.env.APP_URL; // e.g. https://disney-planner.up.railway.app
  if (!appUrl) {
    console.log("No APP_URL set — bot can't link to Mini App");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      "🏰 *Disneyland Paris Planner*\n\n" +
      "Рейтинг аттракционов, live очереди, тепловые карты загруженности и готовые планы дня.\n\n" +
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
      "/help — эта справка",
      { parse_mode: "Markdown" }
    );
  });

  console.log("Telegram bot started");
}
