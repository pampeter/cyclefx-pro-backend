import { Router } from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ----------------------------------------------------------------------------
// API keys — how an MT5 EA authenticates without a browser login.
// Requires the normal JWT login (requireAuth) to CREATE a key, but the key
// itself is what the EA uses on every candle push (see requireApiKey below).
// ----------------------------------------------------------------------------
router.post("/api-keys", requireAuth, async (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });

  const rawKey = `cfx_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  const result = await pool.query(
    `INSERT INTO api_keys (user_id, label, key_hash) VALUES ($1,$2,$3) RETURNING id, label, created_at`,
    [req.userId, label, keyHash]
  );

  // The plaintext key is only ever shown here, once. Only the hash is stored.
  res.status(201).json({ ...result.rows[0], apiKey: rawKey });
});

router.get("/api-keys", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, label, last_used_at, created_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
});

router.delete("/api-keys/:id", requireAuth, async (req, res) => {
  await pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.status(204).end();
});

// ----------------------------------------------------------------------------
// API-key auth middleware — separate from requireAuth (JWT) because an EA
// can't do an interactive login flow. Looks up the hashed key and attaches
// the owning user's id to the request, same shape as requireAuth does.
// ----------------------------------------------------------------------------
async function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || typeof key !== "string") return res.status(401).json({ error: "Missing X-API-Key header" });

  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  const result = await pool.query(
    `SELECT user_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [keyHash]
  );
  if (!result.rows[0]) return res.status(401).json({ error: "Invalid or revoked API key" });

  pool.query(`UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1`, [keyHash]).catch(() => {});
  req.userId = result.rows[0].user_id;
  next();
}

// ----------------------------------------------------------------------------
// Candle ingestion — what an MT5 EA (or any future bridge) pushes to.
// Body: { symbol, timeframe, candles: [{ time, open, high, low, close, volume? }] }
// `time` must be epoch milliseconds. Upserts by (user, symbol, timeframe, time)
// so a live feed can keep pushing the same in-progress candle until it closes.
// ----------------------------------------------------------------------------
const VALID_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

router.post("/candles", requireApiKey, async (req, res) => {
  const { symbol, timeframe, candles } = req.body;
  if (!symbol || typeof symbol !== "string") return res.status(400).json({ error: "symbol is required" });
  if (!VALID_TIMEFRAMES.includes(timeframe)) return res.status(400).json({ error: `timeframe must be one of ${VALID_TIMEFRAMES.join(", ")}` });
  if (!Array.isArray(candles) || candles.length === 0) return res.status(400).json({ error: "candles must be a non-empty array" });
  if (candles.length > 1000) return res.status(400).json({ error: "max 1000 candles per request" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let written = 0;
    for (const c of candles) {
      if ([c.time, c.open, c.high, c.low, c.close].some((v) => v == null || Number.isNaN(Number(v)))) continue;
      await client.query(
        `INSERT INTO mt5_candles (user_id, symbol, timeframe, candle_time, open, high, low, close, volume)
         VALUES ($1,$2,$3,to_timestamp($4/1000.0),$5,$6,$7,$8,$9)
         ON CONFLICT (user_id, symbol, timeframe, candle_time)
         DO UPDATE SET open=$5, high=$6, low=$7, close=$8, volume=$9, received_at=now()`,
        [req.userId, symbol.toUpperCase(), timeframe, c.time, c.open, c.high, c.low, c.close, c.volume ?? null]
      );
      written += 1;
    }
    await client.query("COMMIT");
    res.status(201).json({ accepted: written, rejected: candles.length - written });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Failed to ingest candles" });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// Retrieval — what the frontend/strategy engine reads. Normal JWT auth since
// this is called by the logged-in browser session, not the EA.
// ----------------------------------------------------------------------------
router.get("/candles", requireAuth, async (req, res) => {
  const { symbol, timeframe, limit } = req.query;
  if (!symbol || !VALID_TIMEFRAMES.includes(timeframe)) {
    return res.status(400).json({ error: "symbol and a valid timeframe query params are required" });
  }
  const result = await pool.query(
    `SELECT candle_time, open, high, low, close, volume FROM mt5_candles
     WHERE user_id = $1 AND symbol = $2 AND timeframe = $3
     ORDER BY candle_time DESC LIMIT $4`,
    [req.userId, String(symbol).toUpperCase(), timeframe, Math.min(Number(limit) || 200, 1000)]
  );
  res.json(result.rows.reverse()); // chronological order, oldest first
});

router.get("/symbols", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT symbol, timeframe, MAX(candle_time) AS latest_candle, COUNT(*) AS candle_count
     FROM mt5_candles WHERE user_id = $1 GROUP BY symbol, timeframe ORDER BY symbol, timeframe`,
    [req.userId]
  );
  res.json(result.rows);
});

export default router;
